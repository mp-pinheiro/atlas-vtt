/**
 * The fonts bundled into styles.css, and checks that the texts around them
 * credit each one. styles.css is the only copy of the fonts users get, so the
 * preserved comment above its @font-face rules carries the credits. Every
 * function is pure: callers read the files.
 */

const BUNDLED_FONTS = [
  {
    font: 'src/app/assets/fonts/fantaisie-artistique.ttf',
    licence: 'src/app/assets/fonts/fantaisie-artistique-OFL.txt',
    credit: 'Fantaisie Artistique by George Williams, released under the SIL Open Font License by its author',
    source: 'https://fontforge.org/archive/sfds/toyfonts.html',
    // He published no copyright line with his grant, so no text may give him one.
    authorWithoutCopyright: 'George Williams',
  },
  {
    font: 'src/app/assets/fonts/oxanium.ttf',
    licence: 'src/app/assets/fonts/oxanium-OFL.txt',
    credit: 'Copyright 2019 The Oxanium Project Authors',
    source: 'https://github.com/sevmeyer/oxanium',
  },
];

const LIBRON_CREDIT = 'Libron by Nico Verbruggen, Copyright (c) 2026 Nico Verbruggen, with Reserved Font Name Libron';
const LIBRON_SOURCE = 'https://github.com/nicoverbruggen/libron';
const LIBRON_LICENCE = 'player/src/assets/fonts/libron-OFL.txt';

const PLAYER_FONTS = [
  BUNDLED_FONTS[0],
  { font: 'player/src/assets/fonts/libron-regular.woff2', licence: LIBRON_LICENCE, credit: LIBRON_CREDIT, source: LIBRON_SOURCE },
  { font: 'player/src/assets/fonts/libron-italic.woff2', licence: LIBRON_LICENCE, credit: LIBRON_CREDIT, source: LIBRON_SOURCE },
  { font: 'player/src/assets/fonts/libron-bold.woff2', licence: LIBRON_LICENCE, credit: LIBRON_CREDIT, source: LIBRON_SOURCE },
  { font: 'player/src/assets/fonts/libron-bold-italic.woff2', licence: LIBRON_LICENCE, credit: LIBRON_CREDIT, source: LIBRON_SOURCE },
];

/** Where the notice links the licence text, once for every font. */
const LICENCE_REFERENCE = 'https://openfontlicense.org';

const NOTICE_MARK = 'SIL Open Font License';
const PRESERVED_COMMENTS = /\/\*!([\s\S]*?)\*\//g;
const FONT_FACE_RULES = /@font-face\s*\{/g;
const FONT_DATA_URL = /data:(?:font\/|application\/(?:x-)?font-)/;
// A year beside the name reads as a copyright date too.
const COPYRIGHT_MARK = /copyright|\(c\)|©|\b(?:19|20)\d{2}\b/i;

/** Joins wrapped lines: line breaks, comment ` * ` prefixes and runs of whitespace become single spaces. */
function normalise(text) {
  return text.replace(/^[ \t]*\*(?!\/)/gm, ' ').replace(/\s+/g, ' ').trim();
}

/** One problem per sentence that names an author who published no copyright line beside a copyright mark or a year. */
function copyrightClaimProblems(text, fonts = BUNDLED_FONTS) {
  const sentences = normalise(text).split(/\.(?:\s|$)/);
  return fonts.flatMap(({ authorWithoutCopyright: author }) => {
    if (!author) return [];
    return sentences
      .filter((sentence) => sentence.includes(author) && COPYRIGHT_MARK.test(sentence))
      .map(() => `gives ${author} a copyright line, which the author never published`);
  });
}

/** Problems with the preserved comment that credits the fonts of a stylesheet, built or source. */
function fontNoticeProblems(css, fonts = BUNDLED_FONTS) {
  const notice = [...css.matchAll(PRESERVED_COMMENTS)].find((match) => normalise(match[1]).includes(NOTICE_MARK));
  if (!notice) return ['no preserved font licence notice'];
  const text = normalise(notice[1]);
  const problems = [];
  for (const { credit, source } of fonts) {
    if (!text.includes(credit)) problems.push(`the font licence notice lacks the credit "${credit}"`);
    if (!text.includes(source)) problems.push(`the font licence notice lacks the source ${source}`);
  }
  if (!text.includes(LICENCE_REFERENCE)) problems.push(`the font licence notice does not link the licence text ${LICENCE_REFERENCE}`);
  const firstFont = css.search(FONT_FACE_RULES);
  if (firstFont !== -1 && notice.index > firstFont) problems.push('the font licence notice comes after the first @font-face rule');
  return [...problems, ...copyrightClaimProblems(notice[1], fonts)];
}

/** A built stylesheet must declare exactly the fonts the list names. */
function fontFaceCountProblems(css, fonts = BUNDLED_FONTS) {
  const declared = (css.match(FONT_FACE_RULES) || []).length;
  if (declared === fonts.length) return [];
  return [`declares ${declared} @font-face rules, but scripts/font-notices.js lists ${fonts.length} fonts`];
}

/** The built script must inline no font, since its notice lives in styles.css. */
function scriptFontProblems(js) {
  return FONT_DATA_URL.test(js) ? ['inlines a font, and only styles.css carries the font licence notice'] : [];
}

module.exports = {
  BUNDLED_FONTS,
  PLAYER_FONTS,
  LICENCE_REFERENCE,
  copyrightClaimProblems,
  fontNoticeProblems,
  fontFaceCountProblems,
  scriptFontProblems,
};
