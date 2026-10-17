function clock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const minutes = String(Math.floor(total / 60)).padStart(2, '0')
  const seconds = String(total % 60).padStart(2, '0')
  return `${minutes}:${seconds}`
}

export default function Transport({ snapshot, speeds, markers = [], onToggle, onSeek, onSpeed }) {
  const { position, duration, playing, speed } = snapshot
  const finished = position >= duration

  if (snapshot.live) {
    return (
      <div className="transport is-live">
        <span className="mono">Live feed</span>
        <span className="mono">{clock(position)} since opening</span>
      </div>
    )
  }

  return (
    <div className="transport">
      <button type="button" onClick={onToggle} aria-label={playing ? 'Pause replay' : 'Play replay'}>
        {playing ? 'Pause' : finished ? 'Replay' : 'Play'}
      </button>
      <div className="scrubber">
        <input
          type="range"
          min="0"
          max={Math.round(duration)}
          value={Math.round(position)}
          onChange={(event) => onSeek(Number(event.target.value))}
          aria-label="Replay position"
        />
        {duration > 0 && markers.length > 0 && (
          <div className="scrubber-markers" role="group" aria-label="Run markers">
            {markers.map((marker, index) => {
              const pct = Math.min(100, Math.max(0, (marker.at / duration) * 100))
              return (
                <button
                  key={`${marker.at}-${marker.tone}-${index}`}
                  type="button"
                  className={`scrubber-tick is-${marker.tone}`}
                  style={{ left: `${pct}%` }}
                  onClick={() => onSeek(marker.at)}
                  aria-label={`Seek to ${marker.tone} at ${clock(marker.at)}`}
                />
              )
            })}
          </div>
        )}
      </div>
      <span className="mono">
        {clock(position)} / {clock(duration)}
      </span>
      <div className="speeds" role="group" aria-label="Replay speed">
        {speeds.map((value) => (
          <button key={value} type="button" aria-pressed={value === speed} onClick={() => onSpeed(value)}>
            {value}x
          </button>
        ))}
      </div>
    </div>
  )
}
