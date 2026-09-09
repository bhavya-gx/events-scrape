// Free/discounted admission near SF, curated by hand from the weekly sweep
// research (not live-scraped: these change on the order of months, not days).
// Update the date below whenever this list gets re-checked.
// Covers are Wikimedia Commons photos (hotlinking is allowed there); the
// front end falls back to a tile if one ever disappears.

module.exports = {
  verifiedOn: "2026-09-07",
  perks: [
    {
      name: "SF Botanical Garden",
      offer: "Free for everyone the 2nd Tuesday of every month, and daily 7:30-9:00am for everyone",
      note: "Not resident-gated.",
      url: "https://gggp.org/tickets/",
      place: "Golden Gate Park",
      image: "https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f7/San_Francisco_Botanical_Garden_Great_Lawn_2.jpg/960px-San_Francisco_Botanical_Garden_Great_Lawn_2.jpg",
    },
    {
      name: "Japanese Tea Garden",
      offer: "Free 9-10am Monday, Wednesday and Friday for everyone",
      note: null,
      url: "https://gggp.org/tickets/",
      place: "Golden Gate Park",
      image: "https://thumb.wikimedia.org/wikipedia/commons/thumb/8/81/Japanese_tea_garden_Golden_Gate_Park.JPG/960px-Japanese_tea_garden_Golden_Gate_Park.JPG",
    },
    {
      name: "Conservatory of Flowers",
      offer: "Free the 1st Tuesday of every month",
      note: null,
      url: "https://gggp.org/tickets/",
      place: "Golden Gate Park",
      image: "https://thumb.wikimedia.org/wikipedia/commons/thumb/3/3e/Conservatory_of_Flowers_-_panoramio.jpg/960px-Conservatory_of_Flowers_-_panoramio.jpg",
    },
    {
      name: "de Young + Legion of Honor",
      offer: "Free general admission every Saturday for residents of the 9 Bay Area counties",
      note: "Permanent collection only, special exhibitions still paid. ID showing a Bay Area address checked on site.",
      url: "https://www.famsf.org/events/free-saturdays-de-young",
      place: "Golden Gate Park",
      image: "https://thumb.wikimedia.org/wikipedia/commons/thumb/0/03/De_Young_exterior_%2829059213687%29.jpg/960px-De_Young_exterior_%2829059213687%29.jpg",
    },
  ],
};
