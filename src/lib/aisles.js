/* Grouping a shopping list the way a shop is laid out.

   A list in recipe order sends you back and forth across the shop; a list in
   aisle order is walked once. The matching is keyword-based and deliberately
   simple — it is a convenience, not a taxonomy, and anything it does not
   recognise lands in "Other" rather than being guessed at. */

export const AISLES = [
  { id: 'produce', label: 'Fruit & veg' },
  { id: 'dairy', label: 'Dairy & eggs' },
  { id: 'meat', label: 'Meat & fish' },
  { id: 'bakery', label: 'Bakery' },
  { id: 'dry', label: 'Dry goods' },
  { id: 'tins', label: 'Tins & jars' },
  { id: 'frozen', label: 'Freezer' },
  { id: 'drinks', label: 'Drinks' },
  { id: 'other', label: 'Other' },
];

/* First match wins, so the order within each list matters: "coconut milk" has
   to be seen before plain "milk" or it lands in the dairy aisle.

   Keywords are written in the SINGULAR, because what arrives here has already
   been through normaliseItem — "chopped tomatoes" reaches this file as
   "chopped tomato", and a plural keyword would never match it. */
const KEYWORDS = [
  ['frozen', ['frozen', 'ice cream', 'pea frozen']],
  ['tins', [
    'tinned', 'canned', 'tin of', 'can of', 'jar of', 'passata', 'chopped tomato',
    'plum tomato', 'tomato pur', 'coconut milk', 'chickpea', 'butter bean',
    'kidney bean', 'cannellini', 'lentil tinned', 'anchov', 'olive', 'caper',
    'pickle', 'gherkin', 'jam', 'honey', 'peanut butter', 'stock cube', 'broth',
  ]],
  ['dairy', [
    'milk', 'cream', 'butter', 'cheese', 'pecorino', 'parmesan', 'parmigiano',
    'mozzarella', 'ricotta', 'mascarpone', 'yoghurt', 'yogurt', 'egg', 'creme fraiche',
    'crème fraîche', 'buttermilk', 'ghee',
  ]],
  ['meat', [
    'chicken', 'beef', 'pork', 'lamb', 'veal', 'mince', 'bacon', 'pancetta',
    'guanciale', 'prosciutto', 'sausage', 'ham', 'salami', 'chorizo', 'steak',
    'fish', 'salmon', 'tuna', 'cod', 'prawn', 'shrimp', 'squid', 'mussel', 'clam',
    'crab', 'lobster', 'turkey', 'duck',
  ]],
  ['bakery', [
    'bread', 'loaf', 'baguette', 'ciabatta', 'focaccia', 'roll', 'bun',
    'breadcrumb', 'brioche', 'pitta', 'tortilla', 'croissant',
  ]],
  ['produce', [
    'onion', 'shallot', 'garlic', 'tomato', 'potato', 'carrot', 'celery', 'leek',
    'pepper bell', 'chilli', 'chili', 'courgette', 'zucchini', 'aubergine', 'eggplant',
    'mushroom', 'spinach', 'rocket', 'lettuce', 'cabbage', 'broccoli', 'cauliflower',
    'green bean', 'bean green', 'pea', 'sweetcorn', 'cucumber', 'radish', 'beetroot', 'pumpkin',
    'squash', 'fennel', 'asparagus', 'artichoke', 'lemon', 'lime', 'orange', 'apple',
    'pear', 'banana', 'berry', 'grape', 'peach', 'plum', 'apricot', 'fig',
    'avocado', 'basil', 'parsley', 'coriander', 'cilantro', 'mint', 'rosemary',
    'thyme', 'sage', 'oregano', 'dill', 'chive', 'ginger', 'spring onion', 'scallion',
  ]],
  ['drinks', ['wine', 'beer', 'vermouth', 'brandy', 'rum', 'juice', 'water sparkling', 'coffee', 'tea']],
  ['dry', [
    'flour', 'sugar', 'salt', 'pepper', 'peppercorn', 'rice', 'pasta', 'spaghetti',
    'penne', 'rigatoni', 'tagliatelle', 'linguine', 'macaroni', 'noodle', 'couscous',
    'polenta', 'semolina', 'oat', 'yeast', 'baking powder', 'bicarbonate', 'cornflour',
    'cornstarch', 'vanilla', 'cinnamon', 'nutmeg', 'paprika', 'cumin', 'turmeric',
    'saffron', 'bay leaf', 'chocolate', 'cocoa', 'almond', 'walnut', 'hazelnut',
    'pine nut', 'pistachio', 'raisin', 'sultana', 'lentil', 'oil', 'vinegar',
    'soy sauce', 'mustard', 'stock',
  ]],
];

/**
 * Which aisle an ingredient belongs to.
 * @param {string} item the normalised item name
 * @returns {string} an aisle id, 'other' if nothing matched
 */
export function aisleOf(item) {
  const name = String(item || '').toLowerCase();
  if (!name) return 'other';

  for (const [aisle, keywords] of KEYWORDS) {
    // A keyword of several words has to appear as written; a single word has
    // to match on a word boundary, so "pea" never claims "peanut butter".
    if (keywords.some((keyword) => (
      keyword.includes(' ')
        ? name.includes(keyword)
        : new RegExp(`\\b${keyword}`).test(name)
    ))) {
      return aisle;
    }
  }
  return 'other';
}

/**
 * Sort merged entries into aisles, keeping only the aisles that have anything
 * in them and presenting them in the order a shop is walked.
 * @param {Array<{item: string}>} entries
 */
export function groupByAisle(entries) {
  const byAisle = new Map(AISLES.map((a) => [a.id, []]));
  for (const entry of entries) {
    byAisle.get(aisleOf(entry.item)).push(entry);
  }
  return AISLES
    .map((aisle) => ({ ...aisle, items: byAisle.get(aisle.id) }))
    .filter((aisle) => aisle.items.length);
}
