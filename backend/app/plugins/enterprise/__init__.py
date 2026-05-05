from app.plugins.enterprise.loitering import LoiteringPlugin
from app.plugins.enterprise.line_crossing import LineCrossingPlugin
from app.plugins.enterprise.people_counting import PeopleCountingPlugin
from app.plugins.enterprise.camera_sabotage import CameraSabotagePlugin
from app.plugins.enterprise.epp import EPPPlugin
from app.plugins.enterprise.smoke_fire import SmokeFirePlugin
from app.plugins.enterprise.abandoned_object import AbandonedObjectPlugin
from app.plugins.enterprise.lpr_advanced import LPRAdvancedPlugin
from app.plugins.enterprise.ocr_general import OCRGeneralPlugin
from app.plugins.enterprise.face_recognition import FaceRecognitionPlugin
from app.plugins.enterprise.semantic_search import SemanticSearchPlugin
from app.plugins.enterprise.fall_detection import FallDetectionPlugin
from app.plugins.enterprise.ai_summary import AISummaryPlugin

__all__ = [
    "LoiteringPlugin",
    "LineCrossingPlugin",
    "PeopleCountingPlugin",
    "CameraSabotagePlugin",
    "EPPPlugin",
    "SmokeFirePlugin",
    "AbandonedObjectPlugin",
    "LPRAdvancedPlugin",
    "OCRGeneralPlugin",
    "FaceRecognitionPlugin",
    "SemanticSearchPlugin",
    "FallDetectionPlugin",
    "AISummaryPlugin",
]

plugins = [
    LoiteringPlugin,
    LineCrossingPlugin,
    PeopleCountingPlugin,
    CameraSabotagePlugin,
    EPPPlugin,
    SmokeFirePlugin,
    AbandonedObjectPlugin,
    LPRAdvancedPlugin,
    OCRGeneralPlugin,
    FaceRecognitionPlugin,
    SemanticSearchPlugin,
    FallDetectionPlugin,
    AISummaryPlugin,
]