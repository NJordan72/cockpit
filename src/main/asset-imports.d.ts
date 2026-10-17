// electron-vite resolves `?asset` imports to the file's path at runtime.
declare module '*?asset' {
  const path: string
  export default path
}
