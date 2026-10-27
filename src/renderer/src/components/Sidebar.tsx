import { NavLink } from 'react-router-dom'
import { CompassIcon, GearIcon, HomeIcon, LibraryIcon, MoonIcon } from './Icons'
import { useSettings } from '../settings'

const items = [
  { to: '/', label: 'Home', Icon: HomeIcon },
  { to: '/discover', label: 'Discover', Icon: CompassIcon },
  { to: '/library', label: 'Watchlist', Icon: LibraryIcon }
]

export default function Sidebar() {
  const { settings, update } = useSettings()

  return (
    <nav className="sidebar glass">
      <div className="nav-group">
        {items.map(({ to, label, Icon }) => (
          <NavLink key={to} to={to} end className="nav-item" title={label}>
            <Icon />
            <span>{label}</span>
          </NavLink>
        ))}
      </div>
      <div className="nav-group">
        <button
          className={`nav-item ${settings.nightDim ? 'active' : ''}`}
          title="Night dim"
          onClick={() => update({ nightDim: !settings.nightDim })}
        >
          <MoonIcon />
          <span>Night</span>
        </button>
        <NavLink to="/settings" className="nav-item" title="Settings">
          <GearIcon />
          <span>Settings</span>
        </NavLink>
      </div>
    </nav>
  )
}
