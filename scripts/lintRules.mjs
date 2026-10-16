// The `no-restricted-syntax` selectors that more than one ESLint config reads: the plugin's
// (eslint.config.mjs) and the player client's and relay's (scripts/eslint.base.mjs). One list
// each, so a rule cannot drift between the configs.

// A `title` attribute shows the browser's tooltip. Atlas shows its own
// (`LabelTooltip`) where one is wanted and names controls with `aria-label`.
const TITLE_MESSAGE = "`title` shows the browser tooltip. Use `aria-label`, or `LabelTooltip` for a visible tooltip.";
export const NO_NATIVE_TITLE = [
  { selector: "JSXOpeningElement[name.name=/^[a-z]/] > JSXAttribute[name.name='title']", message: TITLE_MESSAGE },
  { selector: "CallExpression[callee.property.name=/^(setAttribute|setAttr)$/][arguments.0.value='title']", message: TITLE_MESSAGE },
  { selector: "Property[key.name='attr'] > ObjectExpression > Property[key.name='title']", message: TITLE_MESSAGE },
  { selector: "AssignmentExpression > MemberExpression.left[property.name='title'][object.type!='ThisExpression']:not([object.name=/^(doc|document)$/])", message: TITLE_MESSAGE },
];

// Sight rules read a token's vision switch only through the sight policies.
const VISION_FIELD_MESSAGE = "Which tokens give sight or are always seen is decided in vision/tokenSightPolicy.ts.";
export const VISION_FIELD_READS = [
  { selector: "MemberExpression[property.name='enabled'][object.property.name='vision']", message: VISION_FIELD_MESSAGE },
  { selector: "MemberExpression[property.name='enabled'][object.name='vision']", message: VISION_FIELD_MESSAGE },
];
// The import is flagged rather than the call, so an alias cannot pass; the member selector
// catches a namespace import, the export selector a re-export.
const VISION_ON_MESSAGE = "Only sightSources and selectSight ask visionOn; elsewhere ask the picture's SightPolicy (vision/tokenSightPolicy.ts).";
export const VISION_ON_USES = [
  { selector: "ImportSpecifier[imported.name='visionOn']", message: VISION_ON_MESSAGE },
  { selector: "ExportSpecifier[local.name='visionOn']", message: VISION_ON_MESSAGE },
  { selector: "MemberExpression[property.name='visionOn']", message: VISION_ON_MESSAGE },
];
// A note's text reaches the YAML parser only through the helper that checks it first. The import
// is flagged rather than the call, so an alias cannot pass; the member selector catches a
// namespace import, the export selector a re-export, the pattern selector a destructuring.
const PARSE_YAML_MESSAGE = "Parse the YAML of notes, bases and bundles with parseNoteYaml (services/noteYaml.ts), which checks the text first.";
export const PARSE_YAML_USES = [
  { selector: "ImportSpecifier[imported.name='parseYaml']", message: PARSE_YAML_MESSAGE },
  { selector: "ExportSpecifier[local.name='parseYaml']", message: PARSE_YAML_MESSAGE },
  { selector: "MemberExpression[property.name='parseYaml']", message: PARSE_YAML_MESSAGE },
  { selector: "ObjectPattern > Property[key.name='parseYaml']", message: PARSE_YAML_MESSAGE },
  { selector: "ImportDeclaration[source.value='yaml']", message: PARSE_YAML_MESSAGE },
  { selector: "CallExpression[callee.name='require'][arguments.0.value='yaml']", message: PARSE_YAML_MESSAGE },
];
// Atlas' messages are Obsidian's notices in Atlas' look, which only the helper gives them.
export const NATIVE_NOTICE = [
  { selector: "NewExpression[callee.name='Notice']", message: "Show a message with showNotice (src/app/ui/notice.ts), which gives it Atlas' look." },
];
