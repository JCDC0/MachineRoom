function clock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const minutes = String(Math.floor(total / 60)).padStart(2, '0')
  const seconds = String(total % 60).padStart(2, '0')
  return `${minutes}:${seconds}`
}

export default function Transport({ snapshot, speeds, onToggle, onSeek, onSpeed }) {
  const { position, duration, playing, speed } = snapshot
  const finished = position >= duration

  return (
    <div className="transport">
      <button type="button" onClick={onToggle} aria-label={playing ? 'Pause replay' : 'Play replay'}>
        {playing ? 'Pause' : finished ? 'Replay' : 'Play'}
      </button>
      <input
        type="range"
        min="0"
        max={Math.round(duration)}
        value={Math.round(position)}
        onChange={(event) => onSeek(Number(event.target.value))}
        aria-label="Replay position"
      />
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
