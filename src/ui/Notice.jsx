const COPY = {
  loading: ['Loading replay', 'Reading the recorded run.'],
  empty: ['Nothing recorded', 'The replay holds no agent activity yet.'],
  error: ['Replay failed to load', 'The recorded run could not be read.'],
}

export default function Notice({ status, message, title: heading, children }) {
  const [title, text] = COPY[status] ?? COPY.error
  return (
    <main className="notice" role={status === 'error' ? 'alert' : 'status'}>
      <h1>{heading ?? title}</h1>
      <p className="mono">{message ?? text}</p>
      {children}
    </main>
  )
}
