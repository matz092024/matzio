import { useSettings } from '../settings'
import { langName, languages } from '../../../shared/languages'

function Toggle({ label, on, disabled, onChange }: { label: string; on: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      className={`toggle ${on ? 'on' : ''}`}
      onClick={() => onChange(!on)}
    >
      <span />
    </button>
  )
}

/** The language list, plus a code picked in the player that isn't in it. */
function LanguageOptions({ current }: { current: string }) {
  const known = !current || current === 'off' || languages.some((l) => l.code === current)
  return (
    <>
      {!known && <option value={current}>{langName(current)}</option>}
      {[...languages].sort((a, b) => a.name.localeCompare(b.name)).map((l) => (
        <option key={l.code} value={l.code}>{l.name}</option>
      ))}
    </>
  )
}

/** Which audio and subtitle tracks a video starts with. */
export default function TrackSettings() {
  const { settings, update } = useSettings()
  const subLanguage = settings.subLang && settings.subLang !== 'off' ? langName(settings.subLang) : null

  return (
    <section className="settings-group glass">
      <h2 className="settings-heading">Audio and subtitles</h2>
      <div className="setting">
        <div>
          <div className="setting-label">Audio language</div>
          <div className="setting-hint">
            Starts videos in this language when the file has it, otherwise the file’s default. Commentary and audio description tracks are
            skipped either way.
          </div>
        </div>
        <select className="select glass" aria-label="Audio language" value={settings.audioLang} onChange={(e) => update({ audioLang: e.target.value })}>
          <option value="">File default</option>
          <LanguageOptions current={settings.audioLang} />
        </select>
      </div>
      <div className="setting">
        <div>
          <div className="setting-label">Subtitles</div>
          <div className="setting-hint">Turns on subtitles in this language when the file has them.</div>
        </div>
        <select className="select glass" aria-label="Subtitle language" value={settings.subLang} onChange={(e) => update({ subLang: e.target.value })}>
          <option value="">File default</option>
          <option value="off">Off</option>
          <LanguageOptions current={settings.subLang} />
        </select>
      </div>
      <div className="setting" aria-disabled={!subLanguage || undefined}>
        <div>
          <div className="setting-label">Only for other languages</div>
          <div className="setting-hint">
            {subLanguage
              ? `Leaves subtitles off when the audio is already in ${subLanguage}. Forced subtitles for signs and foreign lines still show.`
              : 'Pick a subtitle language above to use this.'}
          </div>
        </div>
        <Toggle
          label="Only for other languages"
          on={settings.subsForeignOnly && !!subLanguage}
          disabled={!subLanguage}
          onChange={(subsForeignOnly) => update({ subsForeignOnly })}
        />
      </div>
      <div className="setting">
        <div>
          <div className="setting-label">Skip SDH subtitles</div>
          <div className="setting-hint">
            Picks regular subtitles over SDH ones (with [door creaks] and speaker names) in the same language. When a video only has SDH,
            those cues are stripped from text subtitles instead.
          </div>
        </div>
        <Toggle label="Skip SDH subtitles" on={settings.avoidSdh} onChange={(avoidSdh) => update({ avoidSdh })} />
      </div>
      <p className="setting-hint">Picking a track in the player’s audio or subtitle menu makes its language the new choice here.</p>
    </section>
  )
}
