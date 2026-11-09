/** Fixed to Lucide 1.62.0 (tag commit 03f11e2); see ./meal-icons/LICENSE.txt. */
export const MEAL_ICON_KEYS = [
  "amphora", "apple", "avocado", "bacon", "banana", "barrel", "bean", "beef", "beer", "blender",
  "bottle-wine", "broccoli", "cake", "cake-slice", "can", "can-soda", "candy", "candy-cane", "carrot", "carton",
  "chef-hat", "cherry", "citrus", "coffee", "cookie", "cooking-pot", "croissant", "cuboid", "cup-soda", "cupcake",
  "dessert", "donut", "door-closed-package", "drumstick", "egg", "egg-fried", "faucet", "fish", "fish-symbol", "glass-water",
  "grape", "groceries", "ham", "hamburger", "hand-platter", "hop", "ice-cream-bowl", "ice-cream-cone", "leafy-green", "lollipop",
  "martini", "microwave", "milk", "nut", "paper-bag", "pizza", "popcorn", "popsicle", "refrigerator", "salad",
  "sandwich", "shell", "shrimp", "snail", "soup", "torus", "tractor", "utensils", "utensils-crossed", "vegan", "wheat", "wine",
] as const;

export type MealIconKey = (typeof MEAL_ICON_KEYS)[number];

const ICON_ASSETS: Record<MealIconKey, string> = {
  amphora: new URL("./meal-icons/amphora.svg", import.meta.url).href,
  apple: new URL("./meal-icons/apple.svg", import.meta.url).href,
  avocado: new URL("./meal-icons/avocado.svg", import.meta.url).href,
  bacon: new URL("./meal-icons/bacon.svg", import.meta.url).href,
  banana: new URL("./meal-icons/banana.svg", import.meta.url).href,
  barrel: new URL("./meal-icons/barrel.svg", import.meta.url).href,
  bean: new URL("./meal-icons/bean.svg", import.meta.url).href,
  beef: new URL("./meal-icons/beef.svg", import.meta.url).href,
  beer: new URL("./meal-icons/beer.svg", import.meta.url).href,
  blender: new URL("./meal-icons/blender.svg", import.meta.url).href,
  "bottle-wine": new URL("./meal-icons/bottle-wine.svg", import.meta.url).href,
  broccoli: new URL("./meal-icons/broccoli.svg", import.meta.url).href,
  cake: new URL("./meal-icons/cake.svg", import.meta.url).href,
  "cake-slice": new URL("./meal-icons/cake-slice.svg", import.meta.url).href,
  can: new URL("./meal-icons/can.svg", import.meta.url).href,
  "can-soda": new URL("./meal-icons/can-soda.svg", import.meta.url).href,
  candy: new URL("./meal-icons/candy.svg", import.meta.url).href,
  "candy-cane": new URL("./meal-icons/candy-cane.svg", import.meta.url).href,
  carrot: new URL("./meal-icons/carrot.svg", import.meta.url).href,
  carton: new URL("./meal-icons/carton.svg", import.meta.url).href,
  "chef-hat": new URL("./meal-icons/chef-hat.svg", import.meta.url).href,
  cherry: new URL("./meal-icons/cherry.svg", import.meta.url).href,
  citrus: new URL("./meal-icons/citrus.svg", import.meta.url).href,
  coffee: new URL("./meal-icons/coffee.svg", import.meta.url).href,
  cookie: new URL("./meal-icons/cookie.svg", import.meta.url).href,
  "cooking-pot": new URL("./meal-icons/cooking-pot.svg", import.meta.url).href,
  croissant: new URL("./meal-icons/croissant.svg", import.meta.url).href,
  cuboid: new URL("./meal-icons/cuboid.svg", import.meta.url).href,
  "cup-soda": new URL("./meal-icons/cup-soda.svg", import.meta.url).href,
  cupcake: new URL("./meal-icons/cupcake.svg", import.meta.url).href,
  dessert: new URL("./meal-icons/dessert.svg", import.meta.url).href,
  donut: new URL("./meal-icons/donut.svg", import.meta.url).href,
  "door-closed-package": new URL("./meal-icons/door-closed-package.svg", import.meta.url).href,
  drumstick: new URL("./meal-icons/drumstick.svg", import.meta.url).href,
  egg: new URL("./meal-icons/egg.svg", import.meta.url).href,
  "egg-fried": new URL("./meal-icons/egg-fried.svg", import.meta.url).href,
  faucet: new URL("./meal-icons/faucet.svg", import.meta.url).href,
  fish: new URL("./meal-icons/fish.svg", import.meta.url).href,
  "fish-symbol": new URL("./meal-icons/fish-symbol.svg", import.meta.url).href,
  "glass-water": new URL("./meal-icons/glass-water.svg", import.meta.url).href,
  grape: new URL("./meal-icons/grape.svg", import.meta.url).href,
  groceries: new URL("./meal-icons/groceries.svg", import.meta.url).href,
  ham: new URL("./meal-icons/ham.svg", import.meta.url).href,
  hamburger: new URL("./meal-icons/hamburger.svg", import.meta.url).href,
  "hand-platter": new URL("./meal-icons/hand-platter.svg", import.meta.url).href,
  hop: new URL("./meal-icons/hop.svg", import.meta.url).href,
  "ice-cream-bowl": new URL("./meal-icons/ice-cream-bowl.svg", import.meta.url).href,
  "ice-cream-cone": new URL("./meal-icons/ice-cream-cone.svg", import.meta.url).href,
  "leafy-green": new URL("./meal-icons/leafy-green.svg", import.meta.url).href,
  lollipop: new URL("./meal-icons/lollipop.svg", import.meta.url).href,
  martini: new URL("./meal-icons/martini.svg", import.meta.url).href,
  microwave: new URL("./meal-icons/microwave.svg", import.meta.url).href,
  milk: new URL("./meal-icons/milk.svg", import.meta.url).href,
  nut: new URL("./meal-icons/nut.svg", import.meta.url).href,
  "paper-bag": new URL("./meal-icons/paper-bag.svg", import.meta.url).href,
  pizza: new URL("./meal-icons/pizza.svg", import.meta.url).href,
  popcorn: new URL("./meal-icons/popcorn.svg", import.meta.url).href,
  popsicle: new URL("./meal-icons/popsicle.svg", import.meta.url).href,
  refrigerator: new URL("./meal-icons/refrigerator.svg", import.meta.url).href,
  salad: new URL("./meal-icons/salad.svg", import.meta.url).href,
  sandwich: new URL("./meal-icons/sandwich.svg", import.meta.url).href,
  shell: new URL("./meal-icons/shell.svg", import.meta.url).href,
  shrimp: new URL("./meal-icons/shrimp.svg", import.meta.url).href,
  snail: new URL("./meal-icons/snail.svg", import.meta.url).href,
  soup: new URL("./meal-icons/soup.svg", import.meta.url).href,
  torus: new URL("./meal-icons/torus.svg", import.meta.url).href,
  tractor: new URL("./meal-icons/tractor.svg", import.meta.url).href,
  utensils: new URL("./meal-icons/utensils.svg", import.meta.url).href,
  "utensils-crossed": new URL("./meal-icons/utensils-crossed.svg", import.meta.url).href,
  vegan: new URL("./meal-icons/vegan.svg", import.meta.url).href,
  wheat: new URL("./meal-icons/wheat.svg", import.meta.url).href,
  wine: new URL("./meal-icons/wine.svg", import.meta.url).href,
};

export type MealIconChoice = { key: MealIconKey; label: string; src: string };

export const MEAL_ICON_CHOICES: MealIconChoice[] = MEAL_ICON_KEYS.map((key) => ({
  key,
  label: key.replace(/-/g, " "),
  src: ICON_ASSETS[key],
}));

export function searchMealIcons(query: string): MealIconChoice[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [...MEAL_ICON_CHOICES];
  return MEAL_ICON_CHOICES.filter((icon) => icon.key.includes(needle) || icon.label.includes(needle));
}

export function mealIconAssetUrl(iconKey?: string | null): string {
  return iconKey && Object.prototype.hasOwnProperty.call(ICON_ASSETS, iconKey)
    ? ICON_ASSETS[iconKey as MealIconKey]
    : ICON_ASSETS.utensils;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

export function renderMealIcon(iconKey?: string | null, options: { size?: number; className?: string } = {}): string {
  const size = Number.isFinite(options.size) ? Math.max(1, Math.round(options.size!)) : 24;
  const className = options.className ? ` class="${escapeAttr(options.className)}"` : "";
  return `<img src="${escapeAttr(mealIconAssetUrl(iconKey))}" width="${size}" height="${size}"${className} alt="" aria-hidden="true">`;
}
