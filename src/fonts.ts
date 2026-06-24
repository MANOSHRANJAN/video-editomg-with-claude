import {staticFile} from 'remotion';

export const FONTS = {
  inter: 'Inter',
  interBlack: 'InterBlack',
  aston: 'AstonScript',
  garamond: 'Garamond',
  garamondBold: 'GaramondBold',
} as const;

let loaded = false;

export const ensureFontsLoaded = async () => {
  if (loaded || typeof document === 'undefined') return;
  const families: Array<[string, string]> = [
    [FONTS.inter, 'fonts/Inter_28pt-ExtraBold.ttf'],
    [FONTS.interBlack, 'fonts/Inter_28pt-Black.ttf'],
    [FONTS.aston, 'fonts/Aston Script.ttf'],
    [FONTS.garamond, 'fonts/AppleGaramond.ttf'],
    [FONTS.garamondBold, 'fonts/AppleGaramond-Bold.ttf'],
  ];
  for (const [family, path] of families) {
    const f = new FontFace(family, `url(${staticFile(path)})`);
    await f.load();
    document.fonts.add(f);
  }
  loaded = true;
};
