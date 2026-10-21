export const FOLDER_SHAPE = 'folders'
export const FOLDER_SHAPE_ACCEPT = `application/json; shape=${FOLDER_SHAPE}`

const NOT_A_LIST = 'The bridge sent a file list this page cannot read.'

function refuse(detail) {
  return { error: `${NOT_A_LIST} ${detail}` }
}

function isId(value, below) {
  return Number.isInteger(value) && value >= 0 && value < below
}

function readFolders(folders, runs) {
  if (!Array.isArray(folders)) return refuse('Its folders are not a list.')
  if (!Array.isArray(runs)) return refuse('Its files are not a list.')
  const paths = ['']
  for (const entry of folders) {
    if (!Array.isArray(entry) || entry.length !== 2) return refuse(`Folder ${paths.length} is not a parent and a name.`)
    const [parent, name] = entry
    if (!isId(parent, paths.length) || typeof name !== 'string') return refuse(`Folder ${paths.length} is not a parent and a name.`)
    paths.push(parent === 0 ? name : `${paths[parent]}/${name}`)
  }
  const files = []
  for (const run of runs) {
    if (!Array.isArray(run) || run.length < 2 || !isId(run[0], paths.length)) return refuse(`Entry ${files.length} is not a folder and its file names.`)
    const folder = paths[run[0]]
    for (let i = 1; i < run.length; i += 1) {
      if (typeof run[i] !== 'string') return refuse(`Entry ${files.length} is not a folder and its file names.`)
      files.push(run[0] === 0 ? run[i] : `${folder}/${run[i]}`)
    }
  }
  return { files }
}

export function readFileList(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return refuse('It is not an object.')
  const root = data.root ?? ''
  if (typeof root !== 'string') return refuse('Its root is not a name.')
  if (data.shape === undefined) {
    if (!Array.isArray(data.files) || data.files.some((file) => typeof file !== 'string')) return refuse('Its files are not a list of paths.')
    return { root, files: [...data.files] }
  }
  if (data.shape !== FOLDER_SHAPE) return refuse('Its shape is unknown. Update the page or the bridge.')
  const read = readFolders(data.folders, data.files)
  return read.error ? read : { root, files: read.files }
}
