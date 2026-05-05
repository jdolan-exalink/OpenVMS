/**
 * SchemaForm — renders a form from a JSON Schema object.
 *
 * Supported field types:
 *   boolean           → toggle switch
 *   string + enum     → <select>
 *   string            → <input type="text">
 *   number / integer  → <input type="number"> (+ slider if min+max present)
 *   array of string   → tag pill input
 *   object / complex  → collapsible JSON textarea
 */

import { useState } from "react";

export interface SchemaProperty {
  type?: string | string[];
  title?: string;
  description?: string;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  items?: { type?: string };
  enum?: unknown[];
  properties?: Record<string, SchemaProperty>;
  additionalProperties?: unknown;
}

export interface JsonSchema {
  type?: string;
  title?: string;
  description?: string;
  properties?: Record<string, SchemaProperty>;
  required?: string[];
}

interface SchemaFormProps {
  schema: JsonSchema;
  value: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
}

export default function SchemaForm({ schema, value, onChange }: SchemaFormProps) {
  if (!schema.properties || Object.keys(schema.properties).length === 0) {
    return (
      <p className="text-xs text-[var(--text-3)]">Este plugin no tiene configuración personalizable.</p>
    );
  }

  return (
    <div className="space-y-3">
      {Object.entries(schema.properties).map(([key, prop]) => (
        <SchemaField
          key={key}
          fieldKey={key}
          prop={prop}
          value={value[key]}
          required={schema.required?.includes(key) ?? false}
          onChange={(v) => onChange({ ...value, [key]: v })}
        />
      ))}
    </div>
  );
}

interface FieldProps {
  fieldKey: string;
  prop: SchemaProperty;
  value: unknown;
  required: boolean;
  onChange: (v: unknown) => void;
}

function SchemaField({ fieldKey, prop, value, required, onChange }: FieldProps) {
  const rawType = Array.isArray(prop.type) ? prop.type.find((t) => t !== "null") ?? "string" : prop.type ?? "string";
  const label = prop.title || fieldKey;
  const current = value !== undefined ? value : prop.default;

  const fieldClass =
    "mt-1 w-full rounded border border-[var(--line)] bg-[var(--bg-2)] px-3 py-1.5 text-xs text-[var(--text-0)] outline-none transition focus:border-[var(--acc)]";

  return (
    <div>
      <div className="flex items-center gap-1.5">
        <label className="text-xs font-medium text-[var(--text-1)]">{label}</label>
        {required && <span className="text-[10px] text-[var(--warn)]">*</span>}
        {rawType === "boolean" && (
          <Toggle
            value={Boolean(current)}
            onChange={(v) => onChange(v)}
          />
        )}
      </div>
      {prop.description && (
        <p className="mt-px text-[10px] text-[var(--text-3)]">{prop.description}</p>
      )}

      {rawType === "boolean" ? null : rawType === "string" && prop.enum ? (
        <select
          value={String(current ?? "")}
          onChange={(e) => onChange(e.target.value)}
          className={fieldClass}
        >
          {prop.enum.map((opt) => (
            <option key={String(opt)} value={String(opt)}>
              {String(opt)}
            </option>
          ))}
        </select>
      ) : rawType === "string" ? (
        <input
          type="text"
          value={String(current ?? "")}
          onChange={(e) => onChange(e.target.value)}
          className={fieldClass}
        />
      ) : rawType === "number" || rawType === "integer" ? (
        <NumberField
          value={current as number | undefined}
          prop={prop}
          rawType={rawType}
          onChange={onChange}
        />
      ) : rawType === "array" && prop.items?.type === "string" ? (
        <TagInput
          value={Array.isArray(current) ? (current as string[]) : []}
          onChange={onChange}
        />
      ) : (
        <JsonEditor value={current} onChange={onChange} />
      )}
    </div>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
      className={`ml-auto flex h-5 w-9 items-center rounded-full transition ${
        value ? "bg-[var(--acc)]" : "bg-[var(--bg-3)]"
      }`}
    >
      <span
        className={`h-4 w-4 rounded-full bg-white shadow transition-transform ${
          value ? "translate-x-4" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

function NumberField({
  value,
  prop,
  rawType,
  onChange,
}: {
  value: number | undefined;
  prop: SchemaProperty;
  rawType: string;
  onChange: (v: unknown) => void;
}) {
  const hasRange = prop.minimum !== undefined && prop.maximum !== undefined;
  const current = value ?? prop.default ?? prop.minimum ?? 0;

  return (
    <div className="flex items-center gap-2">
      {hasRange && (
        <input
          type="range"
          min={prop.minimum}
          max={prop.maximum}
          step={rawType === "integer" ? 1 : 0.05}
          value={Number(current)}
          onChange={(e) =>
            onChange(rawType === "integer" ? parseInt(e.target.value) : parseFloat(e.target.value))
          }
          className="flex-1 accent-[var(--acc)]"
        />
      )}
      <input
        type="number"
        min={prop.minimum}
        max={prop.maximum}
        step={rawType === "integer" ? 1 : 0.05}
        value={Number(current)}
        onChange={(e) =>
          onChange(rawType === "integer" ? parseInt(e.target.value) : parseFloat(e.target.value))
        }
        className="mt-1 w-24 rounded border border-[var(--line)] bg-[var(--bg-2)] px-2 py-1.5 text-xs text-[var(--text-0)] outline-none transition focus:border-[var(--acc)]"
      />
      {hasRange && (
        <span className="mono text-[10px] text-[var(--text-3)]">
          {prop.minimum}–{prop.maximum}
        </span>
      )}
    </div>
  );
}

function TagInput({ value, onChange }: { value: string[]; onChange: (v: unknown) => void }) {
  const [draft, setDraft] = useState("");

  function addTag() {
    const tag = draft.trim();
    if (tag && !value.includes(tag)) {
      onChange([...value, tag]);
    }
    setDraft("");
  }

  function removeTag(tag: string) {
    onChange(value.filter((t) => t !== tag));
  }

  return (
    <div className="mt-1 flex flex-wrap gap-1 rounded border border-[var(--line)] bg-[var(--bg-2)] px-2 py-1.5">
      {value.map((tag) => (
        <span
          key={tag}
          className="flex items-center gap-1 rounded bg-[var(--acc)]/20 px-1.5 py-0.5 text-[10px] text-[var(--acc-strong)]"
        >
          {tag}
          <button
            type="button"
            onClick={() => removeTag(tag)}
            className="leading-none text-[var(--text-3)] hover:text-[var(--warn)]"
          >
            ×
          </button>
        </span>
      ))}
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            addTag();
          }
          if (e.key === "Backspace" && !draft && value.length > 0) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={addTag}
        placeholder="Escribir y Enter…"
        className="min-w-24 flex-1 bg-transparent text-xs text-[var(--text-0)] outline-none placeholder:text-[var(--text-3)]"
      />
    </div>
  );
}

function JsonEditor({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const [raw, setRaw] = useState(() => JSON.stringify(value ?? {}, null, 2));
  const [err, setErr] = useState<string | null>(null);

  function handleChange(text: string) {
    setRaw(text);
    setErr(null);
    try {
      onChange(JSON.parse(text));
    } catch {
      setErr("JSON inválido");
    }
  }

  return (
    <div className="mt-1">
      <textarea
        value={raw}
        onChange={(e) => handleChange(e.target.value)}
        rows={6}
        spellCheck={false}
        className="w-full rounded border border-[var(--line)] bg-[var(--bg-2)] px-3 py-2 font-mono text-[10px] text-[var(--text-0)] outline-none transition focus:border-[var(--acc)]"
      />
      {err && <p className="text-[10px] text-[var(--warn)]">{err}</p>}
    </div>
  );
}
