// @ts-nocheck
/** PKG-5 batch 2 — small shared UI pieces of the K5 administrator pages. */
export function Status({ msg, problem, id }) {
  return (
    <>
      {problem ? <p role="alert" className="text-red-800" data-testid={`${id}-problem`}>{problem}</p> : null}
      <div role="status" aria-live="polite" data-testid={`${id}-status`}>{msg}</div>
    </>
  );
}

export function Field({ id, label, value, onChange, type = 'text', rows }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm">{label}</label>
      {rows ? <textarea id={id} rows={rows} className="w-full rounded border p-2" value={value} onChange={(e) => onChange(e.target.value)} />
        : <input id={id} type={type} className="w-full rounded border p-2" value={value} onChange={(e) => onChange(e.target.value)} />}
    </div>
  );
}

