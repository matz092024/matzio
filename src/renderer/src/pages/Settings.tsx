import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useSettings, type Settings as S } from '../settings'
import AddonsSettings from '../components/AddonsSettings'
import PlayerSetting from '../components/PlayerSetting'
import BufferSettings from '../components/BufferSettings'
import TrackSettings from '../components/TrackSettings'
import TraktSettings from '../components/TraktSettings'
import UpdateSettings from '../components/UpdateSettings'
import DevSettings from '../components/DevSettings'
import { playerShortcutList, shortcutList } from '../shortcuts'

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
        <PlayerSetting />
        <BufferSettings />
        <Item label="Save progress every" hint="How often your place in a movie or episode is saved, here and to Trakt when it’s connected.">
          <div className="interval-slider">
            <input
              className="pl-range"
              type="range"
              min={5}
              max={60}
              step={5}
              value={settings.progressInterval}
              aria-label="Save progress every"
              onChange={(e) => update({ progressInterval: Number(e.target.value) })}
              style={{ ['--pl-progress' as string]: `${((settings.progressInterval - 5) / 55) * 100}%` }}
            />
            <span className="interval-value">{settings.progressInterval} s</span>
          </div>
        </Item>
      </section>

      <TrackSettings />

      <TraktSettings />

      <section className="settings-group glass">
        <h2 className="settings-heading">Connections</h2>
        <Item label="Artwork services" hint="Add TMDB and fanart.tv keys for sharper logos, banners and backgrounds.">
          <Link className="btn btn-glass settings-link" to="/settings/connections">Open</Link>
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

      <AddonsSettings />

      <UpdateSettings />

      <section className="settings-group glass">
        <h2 className="settings-heading">Keyboard</h2>
        <dl className="shortcuts">
          {shortcutList.map(([keys, action]) => (
            <div key={action}>
              <dt>{keys.map((k) => <kbd key={k}>{k}</kbd>)}</dt>
              <dd>{action}</dd>
            </div>
          ))}
        </dl>
        <dl className="shortcuts">
          {playerShortcutList.map(([keys, action]) => (
            <div key={action}>
              <dt>{keys.map((k) => <kbd key={k}>{k}</kbd>)}</dt>
              <dd>{action}</dd>
            </div>
          ))}
        </dl>
        <p className="setting-hint">The second group works while video is playing in the Matzio window. With the player set to a separate window, mpv’s own keys apply instead.</p>
      </section>

      <DevSettings />
    </div>
  )
}
