import { Fingerprint, X } from 'lucide-react'

// Land-Officer-only confirmation dialog for generating a 3D ULPIN. The value
// itself is always generated server-side (see lib/api.js
// generateBuildingThreeDUlpin / generateUnitThreeDUlpin) — this component
// only collects the confirmation click.
export function GenerateThreeDUlpinDialog({ open, onClose, onConfirm, busy, building, floor, unit }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="gen-3dulpin-title"
        className="card w-full max-w-sm p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id="gen-3dulpin-title" className="font-display flex items-center gap-2 text-lg font-semibold text-slate-900">
            <Fingerprint size={18} className="text-primary" /> Generate 3D ULPIN?
          </h2>
          <button onClick={onClose} className="btn-ghost !px-2 !py-1" aria-label="Cancel" type="button">
            <X size={16} />
          </button>
        </div>

        <div className="mt-4">
          <p className="section-title mb-1">Property</p>
          {building && <div className="kv-row"><span className="kv-label">Building</span><span className="kv-value">{building}</span></div>}
          {floor && <div className="kv-row"><span className="kv-label">Floor</span><span className="kv-value">{floor}</span></div>}
          {unit && <div className="kv-row"><span className="kv-label">Unit</span><span className="kv-value">{unit}</span></div>}
        </div>

        <p className="mt-4 text-sm text-slate-600">
          This will create a persistent 3D property identifier for this record. It is a system-generated prototype
          identifier, not an official government ULPIN.
        </p>

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="btn-ghost" type="button" disabled={busy}>
            Cancel
          </button>
          <button onClick={onConfirm} className="btn-primary" type="button" disabled={busy} data-testid="confirm-generate-3d-ulpin">
            {busy ? 'Generating…' : 'Generate 3D ULPIN'}
          </button>
        </div>
      </div>
    </div>
  )
}
