'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ESTIMATE_SCALES, estimateOptions, type EstimateScale } from '@/lib/team-config';
import { teamSettingsApi, movePosition, sortStates, CATEGORIES, type StateCategory, type WorkflowState, type TeamSettings as TS, type CycleSettings, type Label, type LabelGroup } from '@/lib/team-settings-client';
import { Button, Checkbox, IconButton } from '@/components/ui';

const CAT_LABEL: Record<StateCategory, string> = { backlog: 'Backlog', unstarted: 'Unstarted', started: 'Started', completed: 'Completed', canceled: 'Canceled' };
const SCALE_LABEL: Record<EstimateScale, string> = { none: 'Not in use', linear: 'Linear', fibonacci: 'Fibonacci', exponential: 'Exponential', tshirt: 'T-shirt sizes' };
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function Swatch({ color }: { color: string }) {
  // CSP forbids inline styles: the colour is drawn by an SVG fill attribute instead.
  return <svg className="ts-swatch" width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="5" fill={color} /></svg>;
}
const Scope = ({ teamId }: { teamId: string | null }) => <span className="ts-muted ts-scope" data-scope={teamId ? 'team' : 'workspace'}>{teamId ? 'Team' : 'Workspace'}</span>;

export function TeamSettings({ slug, teamId, embedded = false, readOnly = false }: { slug: string; teamId: string; embedded?: boolean; readOnly?: boolean }) {
  const api = useMemo(() => teamSettingsApi(slug), [slug]);
  const [states, setStates] = useState<WorkflowState[]>([]);
  const [settings, setSettings] = useState<TS | null>(null);
  const [cycles, setCycles] = useState<CycleSettings | null>(null);
  const [labels, setLabels] = useState<Label[]>([]);
  const [groups, setGroups] = useState<LabelGroup[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingDelete, setPendingDelete] = useState<{ state: WorkflowState; replacement: string } | null>(null);

  const reload = useCallback(async () => {
    const [s, st, cy, l, g] = await Promise.all([api.listStates(teamId), api.getSettings(teamId), api.getCycleSettings(teamId), api.listLabels(teamId), api.listGroups(teamId)]);
    if (!s.ok) { setError(s.status === 404 ? 'Team not found' : s.message); setLoading(false); return; }
    setStates(s.data.items); if (st.ok) setSettings(st.data); if (cy.ok) setCycles(cy.data);
    if (l.ok) setLabels(l.data.items); if (g.ok) setGroups(g.data.items);
    setLoading(false);
  }, [api, teamId]);
  useEffect(() => { void reload(); }, [reload]);
  const run = async (p: Promise<{ ok: boolean; message?: string }>) => { const r = await p; if (!r.ok) setError(r.message ?? 'Request failed'); else setError(null); await reload(); return r.ok; };
  const removeState = async (s: WorkflowState, replacement?: string) => {
    const r = await api.deleteState(s, replacement);
    if (!r.ok && r.status === 409 && !replacement) { // used by issues: ask for a replacement state of the same team
      const other = states.find((x) => x.id !== s.id);
      setPendingDelete(other ? { state: s, replacement: other.id } : null); setError(r.message); return;
    }
    setPendingDelete(null); setError(r.ok ? null : r.message); await reload();
  };

  const [newState, setNewState] = useState<{ name: string; category: StateCategory; color: string }>({ name: '', category: 'started', color: '#5e6ad2' });
  const [newLabel, setNewLabel] = useState({ name: '', color: '#888888', scope: 'team' as 'team' | 'workspace', group_id: '' });
  const [newGroup, setNewGroup] = useState({ name: '', scope: 'team' as 'team' | 'workspace' });

  if (loading) return <p className="ts-muted" role="status">Loading team settings…</p>;
  const sorted = sortStates(states);
  const Root = embedded ? 'div' : 'main'; // inside the settings shell the shell owns the <main> landmark and the <h1>
  return (
    <Root className="ts" {...(embedded ? {} : { 'aria-labelledby': 'ts-title' })}>
      {!embedded && <h1 id="ts-title">Team settings</h1>}
      {error && <p role="alert" className="ts-error">{error}</p>}
      {readOnly && <p className="ts-muted">Only workspace admins can change these settings.</p>}
      <fieldset className="ts-ro" disabled={readOnly}>

      <section aria-labelledby="ts-wf"><h2 id="ts-wf">Workflow</h2>
        {CATEGORIES.map((category) => (
          <div key={category} className="ts-group"><h3>{CAT_LABEL[category]}</h3>
            <ul>{sorted.filter((s) => s.category === category).map((s) => (
              <li key={s.id} className="ts-row" data-testid={`state-${s.name}`}>
                <Swatch color={s.color} />
                <input aria-label={`Name of ${s.name}`} defaultValue={s.name} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== s.name) void run(api.patchState(s, { name: v })); }} />
                <input type="color" aria-label={`Colour of ${s.name}`} defaultValue={s.color} onChange={(e) => void run(api.patchState(s, { color: e.target.value }))} />
                <select aria-label={`Category of ${s.name}`} value={s.category} onChange={(e) => void run(api.patchState(s, { category: e.target.value as StateCategory }))}>
                  {CATEGORIES.map((t) => <option key={t} value={t}>{CAT_LABEL[t]}</option>)}
                </select>
                <IconButton size={24} label={`Move ${s.name} up`} onClick={() => { const p = movePosition(states, s.id, -1); if (p !== null) void run(api.patchState(s, { position: p })); }}>↑</IconButton>
                <IconButton size={24} label={`Move ${s.name} down`} onClick={() => { const p = movePosition(states, s.id, 1); if (p !== null) void run(api.patchState(s, { position: p })); }}>↓</IconButton>
                <Button variant="ghost" size={24} tone="danger" aria-label={`Delete ${s.name}`} onClick={() => void removeState(s)}>Delete</Button>
              </li>))}</ul>
          </div>))}
        {pendingDelete && <p role="group" className="ts-row" data-testid="replace-state">
          <label>Move its issues to <select aria-label="Replacement state" value={pendingDelete.replacement} onChange={(e) => setPendingDelete({ ...pendingDelete, replacement: e.target.value })}>
            {sorted.filter((x) => x.id !== pendingDelete.state.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          <Button tone="danger" onClick={() => void removeState(pendingDelete.state, pendingDelete.replacement)}>Delete {pendingDelete.state.name}</Button>
          <Button variant="ghost" onClick={() => setPendingDelete(null)}>Cancel</Button></p>}
        <form className="ts-row" onSubmit={(e) => { e.preventDefault(); if (newState.name.trim()) void run(api.createState(teamId, { ...newState, name: newState.name.trim() })).then((ok) => { if (ok) setNewState((n) => ({ ...n, name: '' })); }); }}>
          <input aria-label="New state name" placeholder="New state" value={newState.name} onChange={(e) => setNewState({ ...newState, name: e.target.value })} />
          <select aria-label="New state category" value={newState.category} onChange={(e) => setNewState({ ...newState, category: e.target.value as StateCategory })}>{CATEGORIES.map((t) => <option key={t} value={t}>{CAT_LABEL[t]}</option>)}</select>
          <input type="color" aria-label="New state colour" value={newState.color} onChange={(e) => setNewState({ ...newState, color: e.target.value })} />
          <Button type="submit">Add state</Button>
        </form>
      </section>

      {settings && <section aria-labelledby="ts-est"><h2 id="ts-est">Estimates</h2>
        <label>Scale <select value={settings.estimate_scale} onChange={(e) => void run(api.patchSettings(settings, { estimate_scale: e.target.value as EstimateScale }))}>
          {ESTIMATE_SCALES.map((s) => <option key={s} value={s}>{SCALE_LABEL[s]}</option>)}</select></label>
        <Checkbox checked={settings.estimate_allow_zero} onChange={(e) => void run(api.patchSettings(settings, { estimate_allow_zero: e.target.checked }))} label="Allow zero estimates" />
        <p className="ts-muted" data-testid="estimate-values">{estimateOptions(settings.estimate_scale, settings.estimate_allow_zero).map((o) => o.label).join(' · ') || 'Estimates are off'}</p>
      </section>}

      {cycles && <section aria-labelledby="ts-cyc"><h2 id="ts-cyc">Cycles</h2>
        <Checkbox checked={cycles.enabled} onChange={(e) => void run(api.putCycleSettings(cycles, { enabled: e.target.checked }))} label="Enable cycles" />
        <fieldset disabled={!cycles.enabled}><legend className="ts-muted">Schedule</legend>
          <label>Duration (days) <input type="number" min={1} max={90} defaultValue={cycles.duration_days} onBlur={(e) => { const n = Number(e.target.value); if (n !== cycles.duration_days) void run(api.putCycleSettings(cycles, { duration_days: n })); }} /></label>
          <label>Cooldown (days) <input type="number" min={0} max={30} defaultValue={cycles.cooldown_days} onBlur={(e) => { const n = Number(e.target.value); if (n !== cycles.cooldown_days) void run(api.putCycleSettings(cycles, { cooldown_days: n })); }} /></label>
          <label>Starts on <select value={cycles.start_weekday} onChange={(e) => void run(api.putCycleSettings(cycles, { start_weekday: Number(e.target.value) }))}>
            {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></label>
          <label>Upcoming cycles <input type="number" min={1} max={6} defaultValue={cycles.upcoming_count} onBlur={(e) => { const n = Number(e.target.value); if (n !== cycles.upcoming_count) void run(api.putCycleSettings(cycles, { upcoming_count: n })); }} /></label>
          <Checkbox checked={cycles.auto_rollover} onChange={(e) => void run(api.putCycleSettings(cycles, { auto_rollover: e.target.checked }))} label="Roll unfinished issues over" />
        </fieldset>
      </section>}

      <section aria-labelledby="ts-lab"><h2 id="ts-lab">Labels</h2>
        {[null, ...groups].map((g) => {
          const ls = labels.filter((l) => (l.group_id ?? null) === (g?.id ?? null));
          if (g === null && ls.length === 0) return null;
          return <div key={g?.id ?? 'none'} className="ts-group"><h3>{g ? <><Swatch color={g.color} /> {g.name} <Scope teamId={g.team_id} /> <Button variant="ghost" size={24} tone="danger" aria-label={`Delete group ${g.name}`} onClick={() => void run(api.deleteGroup(g))}>Delete</Button></> : 'Ungrouped'}</h3>
            <ul>{ls.map((l) => <li key={l.id} className="ts-row" data-testid={`label-${l.name}`}>
              <Swatch color={l.color} /><input aria-label={`Name of label ${l.name}`} defaultValue={l.name} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== l.name) void run(api.patchLabel(l, { name: v })); }} />
              <Scope teamId={l.team_id} />
              <select aria-label={`Group of ${l.name}`} value={l.group_id ?? ''} onChange={(e) => void run(api.patchLabel(l, { group_id: e.target.value || null }))}>
                <option value="">No group</option>{groups.filter((x) => !x.team_id || x.team_id === l.team_id).map((x) => <option key={x.id} value={x.id}>{x.name} ({x.team_id ? 'team' : 'workspace'})</option>)}</select>
              <Button variant="ghost" size={24} tone="danger" aria-label={`Delete label ${l.name}`} onClick={() => void run(api.deleteLabel(l))}>Delete</Button></li>)}</ul></div>;
        })}
        <form className="ts-row" onSubmit={(e) => { e.preventDefault(); if (!newLabel.name.trim()) return; void run(api.createLabel({ name: newLabel.name.trim(), color: newLabel.color, team_id: newLabel.scope === 'team' ? teamId : null, group_id: newLabel.group_id || null })).then(() => setNewLabel((n) => ({ ...n, name: '' }))); }}>
          <input aria-label="New label name" placeholder="New label" value={newLabel.name} onChange={(e) => setNewLabel({ ...newLabel, name: e.target.value })} />
          <input type="color" aria-label="New label colour" value={newLabel.color} onChange={(e) => setNewLabel({ ...newLabel, color: e.target.value })} />
          <select aria-label="New label scope" value={newLabel.scope} onChange={(e) => setNewLabel({ ...newLabel, scope: e.target.value as 'team' | 'workspace' })}><option value="team">This team</option><option value="workspace">Workspace</option></select>
          <select aria-label="New label group" value={newLabel.group_id} onChange={(e) => setNewLabel({ ...newLabel, group_id: e.target.value })}><option value="">No group</option>{groups.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.team_id ? 'team' : 'workspace'})</option>)}</select>
          <Button type="submit">Add label</Button>
        </form>
        <form className="ts-row" onSubmit={(e) => { e.preventDefault(); if (!newGroup.name.trim()) return; void run(api.createGroup({ name: newGroup.name.trim(), team_id: newGroup.scope === 'team' ? teamId : null })).then(() => setNewGroup((n) => ({ ...n, name: '' }))); }}>
          <input aria-label="New group name" placeholder="New label group" value={newGroup.name} onChange={(e) => setNewGroup({ ...newGroup, name: e.target.value })} />
          <select aria-label="New group scope" value={newGroup.scope} onChange={(e) => setNewGroup({ ...newGroup, scope: e.target.value as 'team' | 'workspace' })}><option value="team">This team</option><option value="workspace">Workspace</option></select>
          <Button type="submit">Add group</Button>
        </form>
      </section>
      </fieldset>
    </Root>
  );
}
