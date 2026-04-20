/**
 * Green Trends service menus — curated from public price lists (Phase 1).
 * Men: https://www.mygreentrends.in/our-services-men/
 * Women: https://www.mygreentrends.in/womens-salon-services/
 */

export const genderRadioOptions = [
  { id: "male", title: "Male" },
  { id: "female", title: "Female" },
  { id: "kids", title: "Kids" }
];

/** Category dropdown: id + title per gender */
export const categoriesByGender = {
  male: [
    { id: "m_haircut_beard", title: "Hair Cut & Beard" },
    { id: "m_hair_colour", title: "Hair Colouring" },
    { id: "m_hair_spa", title: "Hair Spa & Treatment" },
    { id: "m_facial", title: "Cleanup / Facial & Skin Care" },
    { id: "m_pedi_mani", title: "Pedicure / Manicure" },
    { id: "m_bridal", title: "Bridal" }
  ],
  female: [
    { id: "f_hair_spa", title: "Hair Spa & Treatment" },
    { id: "f_smoothing", title: "Hair Smoothening & Anti Frizz" },
    { id: "f_bridal_mu", title: "Bridal & Make Up" },
    { id: "f_pedi_body", title: "Pedicure / Manicure & Body Care" },
    { id: "f_facial", title: "Cleanup / Facial & Skin Care" },
    { id: "f_hair_colour", title: "Hair Colouring" }
  ],
  kids: [
    { id: "k_hair", title: "Kids Hair" },
    { id: "k_basic", title: "Basic Grooming" }
  ]
};

/** Service line items per gender + category id */
export const servicesByGenderCategory = {
  male: {
    m_haircut_beard: [
      "Hair Cut",
      "Hair Cut Advanced",
      "Hair Cut Senior",
      "Beard Styling",
      "Shave",
      "Shave Senior",
      "Head Shave"
    ],
    m_hair_colour: [
      "Moustache Coloring",
      "Beard Colour Regular",
      "Global Hair Colouring",
      "Krone Global Hair Colouring Ammonia Free",
      "Hair Colouring Ammonia Free"
    ],
    m_hair_spa: [
      "Mentho Burst Spa",
      "Loreal Hair Spa",
      "Loreal Anti Dandruff Treatment",
      "Olaplex Shine & Smooth Hair Spa Short",
      "Head Massage Almond Indulgence"
    ],
    m_facial: [
      "Detan Face",
      "Skin Lightening Face Cleanup 30 Mins",
      "Aroma Skin Lightening Facial",
      "Active Charcoal Facial",
      "Oxygen Facial"
    ],
    m_pedi_mani: [
      "Manicure Classic",
      "Pedicure Classic",
      "Foot Logix Manicure Signature",
      "Foot Logix Pedicure Signature",
      "Ice Cream Pedicure"
    ],
    m_bridal: [
      "Groom Makeup Artist",
      "Groom Makeup Sr Artist",
      "Groom Makeup Expert"
    ]
  },
  female: {
    f_hair_spa: [
      "Mentho Burst Spa Medium",
      "Loreal Hair Spa Medium",
      "Moroccan Oil Hair Spa Medium",
      "Olaplex Shine & Smooth Hair Spa Medium",
      "Head Massage Olive Bliss"
    ],
    f_smoothing: [
      "Straightening Smoothening Medium",
      "Rebonding Medium",
      "Keratin Cysteine Hair Taming Medium",
      "Protein Hair Botox Medium"
    ],
    f_bridal_mu: [
      "Party Makeup Artist",
      "Bridal Makeover Artist",
      "Bridal Makeup Expert",
      "Hairdo Artist",
      "Trial Makeup Artist"
    ],
    f_pedi_body: [
      "Manicure Regular",
      "Pedicure Regular",
      "Foot Logix Pedicure Signature",
      "Crystal Spa Pedicure Regular Women",
      "Threading Eyebrow"
    ],
    f_facial: [
      "Detan Face",
      "Cream Bleach Face",
      "Fair Bloom Facial",
      "24 Karat Gold Facial",
      "Oxygen Facial With Eye Treatment"
    ],
    f_hair_colour: [
      "Root Touch Up",
      "Global Colour",
      "Highlights",
      "Fashion Colour"
    ]
  },
  kids: {
    k_hair: ["Kids Haircut", "Kids Haircut Creative", "Fringe Trim"],
    k_basic: ["Basic Trim", "Kids Cleanup"]
  }
};

export function listCategoriesForGender(gender) {
  return categoriesByGender[gender] || categoriesByGender.female;
}

export function listServiceOptionsForCategory(gender, categoryId) {
  const g = servicesByGenderCategory[gender] || servicesByGenderCategory.female;
  const items = g[categoryId] || [];
  return items.map((title) => ({
    id: `${categoryId}||${title}`,
    title
  }));
}

export function getCategoryTitleById(categoryId) {
  for (const gender of ["male", "female", "kids"]) {
    const found = categoriesByGender[gender]?.find((c) => c.id === categoryId);
    if (found) return found.title;
  }
  return categoryId;
}
