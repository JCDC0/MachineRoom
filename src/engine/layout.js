export function treeFromState(state, rootName) {
  return {
    rootName,
    files: [...state.files.keys()].sort(),
    dirs: [...state.dirs.keys()].sort(),
    created: [],
  }
}
