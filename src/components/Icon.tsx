const PATHS: Record<string, string[]> = {
  home: ['m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M9 22V12h6v10'],
  tag: ['M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4z', 'M7.5 6a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z'],
  users: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
  chart: ['M3 3v18h18', 'M18 17V9', 'M13 17V5', 'M8 17v-3'],
  sliders: ['M4 21v-7', 'M4 10V3', 'M12 21v-9', 'M12 8V3', 'M20 21v-5', 'M20 12V3', 'M2 14h4', 'M10 8h4', 'M18 16h4'],
  truck: ['M10 18V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v11a1 1 0 0 1-1 1h-2', 'M9 18h6', 'M5 18H3a1 1 0 0 1-1-1v-3.65a1 1 0 0 1 .22-.62l3.48-4.35A1 1 0 0 1 6.48 8H10', 'M7 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4z', 'M17 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4z'],
  undo: ['M15 14l5-5-5-5', 'M20 9H9.5A5.5 5.5 0 0 0 4 14.5 5.5 5.5 0 0 0 9.5 20H13'],
  cash: ['M4 6h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z', 'M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4z', 'M6 12h.01M18 12h.01'],
  wallet: ['M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1', 'M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4'],
  receipt: ['M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z', 'M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8', 'M12 17.5v-11'],
  lock: ['M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z', 'M7 11V7a5 5 0 0 1 10 0v4'],
  next: ['m15 18-6-6 6-6'],
  prev: ['m9 18 6-6-6-6'],
  back: ['M5 12h14', 'm12 5 7 7-7 7'],
  plus: ['M5 12h14', 'M12 5v14'],
  download: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'm7 10 5 5 5-5', 'M12 15V3'],
  refresh: ['M3 12a9 9 0 0 1 15-6.7L21 8', 'M21 3v5h-5', 'M21 12a9 9 0 0 1-15 6.7L3 16', 'M8 16H3v5'],
  key: ['M2.6 18.4 12 9', 'M15.5 7.5 17 9l3-3-1.5-1.5', 'M15.5 2a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z'],
  check: ['M20 6 9 17l-5-5'],
  backspace: ['M10 5a2 2 0 0 0-1.3.5l-6.4 5.7a1 1 0 0 0 0 1.6l6.4 5.7A2 2 0 0 0 10 19h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z', 'm12 9 6 6', 'm18 9-6 6'],
  info: ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z', 'M12 16v-4', 'M12 8h.01'],
};

type Props = { name: keyof typeof PATHS | string; size?: number; stroke?: number };

export function Icon({ name, size = 22, stroke = 2 }: Props) {
  const paths = PATHS[name] ?? [];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}
