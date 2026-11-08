import { useState } from 'react';
import { orderedBadges } from '../lib/badges';
import type { BadgeCatalog, SkateClassFields } from '../lib/types';

interface Props {
  catalog: BadgeCatalog;
  initial?: SkateClassFields & { badge_ids: number[] };
  submitLabel: string;
  busy: boolean;
  onSubmit: (fields: SkateClassFields, badgeIds: number[]) => void;
  onCancel: () => void;
}

const BLANK: SkateClassFields = {
  name: '',
  starts_at: null,
  ends_at: null,
  min_age: null,
  max_age: null,
  coach_name: null,
};

export function ClassForm({ catalog, initial, submitLabel, busy, onSubmit, onCancel }: Props) {
  const [fields, setFields] = useState<SkateClassFields>(initial ?? BLANK);
  const [badgeIds, setBadgeIds] = useState<number[]>(initial?.badge_ids ?? []);
  const set = <K extends keyof SkateClassFields>(k: K, v: SkateClassFields[K]) =>
    setFields((f) => ({ ...f, [k]: v }));
  const num = (v: string) => (v ? Number(v) : null);
  const time = (v: string | null) => (v ? v.slice(0, 5) : '');

  return (
    <form
      className="subform class-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ ...fields, name: fields.name.trim(), coach_name: fields.coach_name?.trim() || null }, badgeIds);
      }}
    >
      <div className="grid">
        <label>
          Class name
          <input required value={fields.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Beginner Classes" />
        </label>
        <label>
          Starts
          <input type="time" value={time(fields.starts_at)} onChange={(e) => set('starts_at', e.target.value || null)} />
        </label>
        <label>
          Ends
          <input type="time" value={time(fields.ends_at)} onChange={(e) => set('ends_at', e.target.value || null)} />
        </label>
        <label>
          Coach (optional)
          <input value={fields.coach_name ?? ''} onChange={(e) => set('coach_name', e.target.value || null)} />
        </label>
        <label>
          Youngest age (optional)
          <input type="number" min={1} value={fields.min_age ?? ''} onChange={(e) => set('min_age', num(e.target.value))} />
        </label>
        <label>
          Oldest age (optional)
          <input type="number" min={1} value={fields.max_age ?? ''} onChange={(e) => set('max_age', num(e.target.value))} />
        </label>
      </div>

      <fieldset className="checkbox-group badges-covered">
        <legend>Badges this class covers</legend>
        {catalog.streams.map((stream) => (
          <div key={stream.id} className="stream-badges">
            <span className="muted">{stream.name}:</span>
            {orderedBadges(catalog)
              .filter((b) => b.stream_id === stream.id)
              .map((b) => (
                <label key={b.id} className="checkbox">
                  <input
                    type="checkbox"
                    checked={badgeIds.includes(b.id)}
                    onChange={(e) =>
                      setBadgeIds((ids) => (e.target.checked ? [...ids, b.id] : ids.filter((i) => i !== b.id)))
                    }
                  />
                  {b.name}
                </label>
              ))}
          </div>
        ))}
      </fieldset>

      <div className="form-actions">
        <button type="submit" className="primary" disabled={busy}>
          {submitLabel}
        </button>
        <button type="button" className="link-button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
