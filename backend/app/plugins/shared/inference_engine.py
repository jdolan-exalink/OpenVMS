from enum import Enum
from pathlib import Path
from typing import Optional


class InferenceBackend(Enum):
    TENSORRT = "tensorrt"
    OPENVINO = "openvino"
    ONNX_CPU = "onnx_cpu"
    PYTORCH_CPU = "pytorch_cpu"


class InferenceEngine:
    model_path: Path
    backend: InferenceBackend
    _model: Optional[object] = None
    _session: Optional[object] = None

    def __init__(
        self,
        model_path: str,
        backend: Optional[InferenceBackend] = None,
    ):
        self.model_path = Path(model_path)
        self.backend = backend or self.detect_best_backend()

    @staticmethod
    def detect_best_backend() -> InferenceBackend:
        try:
            import torch
            if torch.cuda.is_available():
                return InferenceBackend.TENSORRT
        except ImportError:
            pass
        try:
            import openvino
            return InferenceBackend.OPENVINO
        except ImportError:
            pass
        try:
            import onnxruntime
            return InferenceBackend.ONNX_CPU
        except ImportError:
            pass
        return InferenceBackend.PYTORCH_CPU

    async def load(self) -> None:
        if self.backend == InferenceBackend.TENSORRT:
            from ultralytics import YOLO

            self._model = YOLO(str(self.model_path))
            self._model.to("cuda")

        elif self.backend == InferenceBackend.OPENVINO:
            from ultralytics import YOLO

            xml_path = self.model_path.with_suffix(".xml")
            if not xml_path.exists():
                base = YOLO(str(self.model_path))
                base.export(format="openvino")
            self._model = YOLO(str(xml_path))

        elif self.backend == InferenceBackend.ONNX_CPU:
            import onnxruntime as ort

            onnx_path = self.model_path.with_suffix(".onnx")
            if not onnx_path.exists():
                from ultralytics import YOLO

                base = YOLO(str(self.model_path))
                base.export(format="onnx", opset=17, simplify=True)
            self._session = ort.InferenceSession(
                str(onnx_path),
                providers=["CPUExecutionProvider"],
            )

        else:
            from ultralytics import YOLO

            self._model = YOLO(str(self.model_path))
            self._model.to("cpu")

    async def predict(
        self,
        image,
        conf: float = 0.5,
        iou: float = 0.45,
    ) -> list[dict]:
        if self.backend == InferenceBackend.ONNX_CPU:
            return await self._predict_onnx(image, conf, iou)
        return await self._predict_yolo(image, conf, iou)

    async def _predict_yolo(
        self,
        image,
        conf: float,
        iou: float,
    ) -> list[dict]:
        import cv2
        import numpy as np

        if isinstance(image, bytes):
            image = cv2.imdecode(np.frombuffer(image, np.uint8), cv2.IMREAD_COLOR)

        results = self._model.predict(image, conf=conf, iou=iou, verbose=False)
        detections = []
        for r in results:
            for box in r.boxes:
                detections.append(
                    {
                        "class_id": int(box.cls[0]),
                        "class_name": r.names[int(box.cls[0])],
                        "confidence": float(box.conf[0]),
                        "bbox": {
                            "x1": int(box.xyxy[0][0].item()),
                            "y1": int(box.xyxy[0][1].item()),
                            "x2": int(box.xyxy[0][2].item()),
                            "y2": int(box.xyxy[0][3].item()),
                        },
                    }
                )
        return detections

    async def _predict_onnx(
        self,
        image,
        conf: float,
        iou: float,
    ) -> list[dict]:
        import cv2
        import numpy as np

        if isinstance(image, bytes):
            image = cv2.imdecode(np.frombuffer(image, np.uint8), cv2.IMREAD_COLOR)

        h, w = image.shape[:2]
        resized = cv2.resize(image, (640, 640))
        tensor = resized.transpose(2, 0, 1).astype(np.float32) / 255.0
        tensor = tensor.reshape(1, 3, 640, 640)

        input_name = self._session.get_inputs()[0].name
        output_name = self._session.get_outputs()[0].name
        outputs = self._session.run([output_name], {input_name: tensor})[0]

        detections = self._onnx_postprocess(outputs, conf, w, h)
        return detections

    def _onnx_postprocess(
        self,
        outputs,
        conf_threshold: float,
        orig_w: int,
        orig_h: int,
    ) -> list[dict]:
        import cv2
        import numpy as np

        outputs = outputs[0].T
        boxes, scores = outputs[:, :4], outputs[:, 4:]
        class_ids = np.argmax(scores, axis=1)
        confidences = np.max(scores, axis=1)

        mask = confidences > conf_threshold
        boxes = boxes[mask]
        scores = confidences[mask]
        class_ids = class_ids[mask]

        h, w = 640, 640
        detections = []
        for i in range(len(boxes)):
            x1, y1, x2, y2 = boxes[i]
            scale_x, scale_y = orig_w / w, orig_h / h
            detections.append(
                {
                    "class_id": int(class_ids[i]),
                    "class_name": str(class_ids[i]),
                    "confidence": float(scores[i]),
                    "bbox": {
                        "x1": max(0, int(x1 * scale_x)),
                        "y1": max(0, int(y1 * scale_y)),
                        "x2": min(orig_w, int(x2 * scale_x)),
                        "y2": min(orig_h, int(y2 * scale_y)),
                    },
                }
            )

        boxes_xyxy = np.array([[d["bbox"]["x1"], d["bbox"]["y1"], d["bbox"]["x2"], d["bbox"]["y2"]] for d in detections])
        if len(boxes_xyxy) > 0:
            keep = cv2.dnn.NMSBoxes(
                [(x1, y1, x2 - x1, y2 - y1) for x1, y1, x2, y2 in boxes_xyxy],
                [d["confidence"] for d in detections],
                conf_threshold,
                0.45,
            )
            if isinstance(keep, np.ndarray):
                keep = keep.flatten()
            detections = [detections[i] for i in keep]

        return detections

    async def unload(self) -> None:
        self._model = None
        self._session = None