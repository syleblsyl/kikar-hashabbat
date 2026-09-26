declare const __APP_VERSION__: string;
declare module '*.css';
declare module '*?url' {
  const src: string;
  export default src;
}
