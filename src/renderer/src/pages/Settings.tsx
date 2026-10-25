import type { ReactNode } from 'react'
import { useSettings, type Settings as S } from '../settings'

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button role="switch" aria-checked={on} className={`toggle ${on ? 'on' : ''}`} onClick={() => onChange(!on)}>
      <span />
    </button>
  )
}

function Choice<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented glass">
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? 'active' : ''} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  )
}

function Item({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <div className="setting">
      <div>
        <div className="setting-label">{label}</div>
        <div className="setting-hint">{hint}</div>
      </div>
      {children}
    </div>
  )
}

export default function Settings() {
  const { settings, update } = useSettings()

  return (
    <div className="page narrow">
      <header className="page-header">
        <h1 className="page-title">Settings</h1>
      </header>

      <section className="settings-group glass">
        <h2 className="settings-heading">Playback</h2>
        <Item label="Play button" hint="Start the first stream right away, or always show the stream list.">
          <Choice<S['quickPlay']>
            value={settings.quickPlay}
            onChange={(quickPlay) => update({ quickPlay })}
            options={[{ value: 'first', label: 'Play first stream' }, { value: 'ask', label: 'Let me choose' }]}
          />
        </Item>
      </section>

      <section className="settings-group glass">
        <h2 className="settings-heading">Appearance</h2>
        <Item label="Night dim" hint="Lowers brightness and contrast across the app for late-night watching.">
          <Toggle on={settings.nightDim} onChange={(nightDim) => update({ nightDim })} />
        </Item>
        <Item label="Glass" hint="How frosted the panels look.">
          <Choice<S['glass']>
            value={settings.glass}
            onChange={(glass) => update({ glass })}
            options={[{ value: 'subtle', label: 'Subtle' }, { value: 'normal', label: 'Normal' }, { value: 'strong', label: 'Strong' }]}
          />
        </Item>
        <Item label="Reduce motion" hint="Turns off hover lifts and transitions.">
          <Toggle on={settings.reduceMotion} onChange={(reduceMotion) => update({ reduceMotion })} />
        </Item>
      </section>

      <section className="settings-group glass">
        <h2 className="settings-heading">Addons</h2>
        <p className="setting-hint">Installing Stremio addons by URL arrives in the next step.</p>
      </section>
    </div>
  )
}
