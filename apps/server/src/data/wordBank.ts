import type { Difficulty, WordCategory } from "@imposter/shared";

export type WordPair = {
  id: string;
  wordA: string;
  wordB: string;
  category: WordCategory;
  difficulty: Difficulty;
  /** What links the two words (their shared context). Required by the word-pair review. */
  tags: string[];
};

/**
 * Curated, human-reviewed word pairs.
 *
 * How this game uses a pair: the Imposter is told their role and gets one word of the pair;
 * everyone else gets the other. Clues are submitted blind and revealed together, then the group
 * discusses and votes. Either word can be the main word (the orientation is random), so a pair
 * must work in both directions. A pair is judged on gameplay, not on dictionary similarity:
 *
 *  1. Distinguishable: the words name clearly different things that nobody uses
 *     interchangeably, so careful clues can expose the Imposter. No synonyms, spelling
 *     variants, "a smaller X" or "a kind of X" pairs (Mountain / Hill, Sofa / Couch).
 *  2. Linked: the words share at least one trait or context (the `tags`), so the Imposter's
 *     blind clue has a fair chance to fit and one clue does not settle the round. The words may
 *     come from different domains (category "Mixed", e.g. Zebra / Piano), but a pair with no
 *     shared trait at all (Telescope / Banana) gives the Imposter nothing to work with.
 *  3. Category-honest: outside "Mixed", BOTH words belong to the pair's category. The host's
 *     category choice is public, so a misfiled word would mislead players.
 *  4. Lexically separate: the words must not share a stem or contain each other
 *     (Pancake / Cupcake, Pen / Pencil). Chat moderation blocks each player's own word in
 *     its variants, and would then also block the partner word.
 *
 * Difficulty is about how much the words' natural clues overlap:
 *  - Easy:   clearly different things with one obvious link; most clues fit only one word.
 *  - Medium: same domain or several shared traits, but each word has well-known features of its own.
 *  - Hard:   close neighbours where many generic clues fit both; separating them needs specific,
 *            careful clues. Still never interchangeable words.
 *
 * Every category offers at least three pairs per difficulty, so any category/difficulty choice
 * can start a game and a default three-round game never repeats a pair.
 *
 * Before adding or changing a pair, run `npm run words:review`. It reports structural errors,
 * reviewed-and-rejected pairs (see data/wordPairReview.ts) and possible near-synonyms for review.
 */
export const fallbackWordBank: WordPair[] = [
  // Food
  { id: "food-01", wordA: "Sushi", wordB: "Taco", category: "Food", difficulty: "Easy", tags: ["takeout", "world-cuisine"] },
  { id: "food-02", wordA: "Soup", wordB: "Salad", category: "Food", difficulty: "Easy", tags: ["starter"] },
  { id: "food-03", wordA: "Watermelon", wordB: "Coconut", category: "Food", difficulty: "Easy", tags: ["fruit", "refreshing"] },
  { id: "food-04", wordA: "Popcorn", wordB: "Chocolate", category: "Food", difficulty: "Easy", tags: ["snack"] },
  { id: "food-05", wordA: "Pizza", wordB: "Burger", category: "Food", difficulty: "Medium", tags: ["fast-food"] },
  { id: "food-06", wordA: "Coffee", wordB: "Tea", category: "Food", difficulty: "Medium", tags: ["hot-drink"] },
  { id: "food-07", wordA: "Mango", wordB: "Pineapple", category: "Food", difficulty: "Medium", tags: ["tropical-fruit"] },
  { id: "food-08", wordA: "Cupcake", wordB: "Donut", category: "Food", difficulty: "Medium", tags: ["sweet-treat"] },
  { id: "food-09", wordA: "Ketchup", wordB: "Mustard", category: "Food", difficulty: "Medium", tags: ["condiment"] },
  { id: "food-10", wordA: "Honey", wordB: "Jam", category: "Food", difficulty: "Hard", tags: ["sweet-spread"] },
  { id: "food-11", wordA: "Butter", wordB: "Cheese", category: "Food", difficulty: "Hard", tags: ["dairy"] },
  { id: "food-12", wordA: "Garlic", wordB: "Onion", category: "Food", difficulty: "Hard", tags: ["cooking-bulb"] },

  // Animals
  { id: "animals-01", wordA: "Elephant", wordB: "Giraffe", category: "Animals", difficulty: "Easy", tags: ["safari", "giant"] },
  { id: "animals-02", wordA: "Owl", wordB: "Parrot", category: "Animals", difficulty: "Easy", tags: ["bird"] },
  { id: "animals-03", wordA: "Rabbit", wordB: "Hamster", category: "Animals", difficulty: "Easy", tags: ["small-pet"] },
  { id: "animals-04", wordA: "Spider", wordB: "Ant", category: "Animals", difficulty: "Easy", tags: ["tiny-creature"] },
  { id: "animals-05", wordA: "Lion", wordB: "Tiger", category: "Animals", difficulty: "Medium", tags: ["big-cat"] },
  { id: "animals-06", wordA: "Dolphin", wordB: "Whale", category: "Animals", difficulty: "Medium", tags: ["sea-mammal"] },
  { id: "animals-07", wordA: "Horse", wordB: "Donkey", category: "Animals", difficulty: "Medium", tags: ["farm", "riding"] },
  { id: "animals-08", wordA: "Penguin", wordB: "Seal", category: "Animals", difficulty: "Medium", tags: ["polar"] },
  { id: "animals-09", wordA: "Wolf", wordB: "Fox", category: "Animals", difficulty: "Hard", tags: ["wild-canine"] },
  { id: "animals-10", wordA: "Goat", wordB: "Sheep", category: "Animals", difficulty: "Hard", tags: ["farm", "herd"] },
  { id: "animals-11", wordA: "Crow", wordB: "Pigeon", category: "Animals", difficulty: "Hard", tags: ["city-bird"] },

  // Sports
  { id: "sports-01", wordA: "Chess", wordB: "Carrom", category: "Sports", difficulty: "Easy", tags: ["indoor-game"] },
  { id: "sports-02", wordA: "Golf", wordB: "Snooker", category: "Sports", difficulty: "Easy", tags: ["ball-into-hole", "precision"] },
  { id: "sports-03", wordA: "Skiing", wordB: "Surfing", category: "Sports", difficulty: "Easy", tags: ["glide", "balance"] },
  { id: "sports-04", wordA: "Cricket", wordB: "Baseball", category: "Sports", difficulty: "Medium", tags: ["bat-and-ball"] },
  { id: "sports-05", wordA: "Football", wordB: "Rugby", category: "Sports", difficulty: "Medium", tags: ["field-team"] },
  { id: "sports-06", wordA: "Tennis", wordB: "Badminton", category: "Sports", difficulty: "Medium", tags: ["racket"] },
  { id: "sports-07", wordA: "Basketball", wordB: "Volleyball", category: "Sports", difficulty: "Medium", tags: ["team", "ball"] },
  { id: "sports-08", wordA: "Boxing", wordB: "Wrestling", category: "Sports", difficulty: "Medium", tags: ["combat"] },
  { id: "sports-09", wordA: "Swimming", wordB: "Diving", category: "Sports", difficulty: "Hard", tags: ["water-sport"] },
  { id: "sports-10", wordA: "Archery", wordB: "Darts", category: "Sports", difficulty: "Hard", tags: ["target"] },
  { id: "sports-11", wordA: "Marathon", wordB: "Sprint", category: "Sports", difficulty: "Hard", tags: ["running-race"] },

  // Movies
  { id: "movies-01", wordA: "Hero", wordB: "Villain", category: "Movies", difficulty: "Easy", tags: ["character"] },
  { id: "movies-02", wordA: "Horror", wordB: "Romance", category: "Movies", difficulty: "Easy", tags: ["genre"] },
  { id: "movies-03", wordA: "Cartoon", wordB: "Documentary", category: "Movies", difficulty: "Easy", tags: ["show-format"] },
  { id: "movies-04", wordA: "Director", wordB: "Producer", category: "Movies", difficulty: "Medium", tags: ["film-crew"] },
  { id: "movies-05", wordA: "Soundtrack", wordB: "Playlist", category: "Movies", difficulty: "Medium", tags: ["music"] },
  { id: "movies-06", wordA: "Actor", wordB: "Stuntman", category: "Movies", difficulty: "Medium", tags: ["performer"] },
  { id: "movies-07", wordA: "Sequel", wordB: "Remake", category: "Movies", difficulty: "Hard", tags: ["follow-up-film"] },
  { id: "movies-08", wordA: "Audition", wordB: "Rehearsal", category: "Movies", difficulty: "Hard", tags: ["acting-prep"] },
  { id: "movies-09", wordA: "Subtitles", wordB: "Dubbing", category: "Movies", difficulty: "Hard", tags: ["foreign-film"] },

  // Places
  { id: "places-01", wordA: "Hospital", wordB: "School", category: "Places", difficulty: "Easy", tags: ["public-building"] },
  { id: "places-02", wordA: "Zoo", wordB: "Circus", category: "Places", difficulty: "Easy", tags: ["animals", "crowd"] },
  { id: "places-03", wordA: "Prison", wordB: "Hotel", category: "Places", difficulty: "Easy", tags: ["rooms", "stay"] },
  { id: "places-04", wordA: "Airport", wordB: "Station", category: "Places", difficulty: "Medium", tags: ["transport-hub"] },
  { id: "places-05", wordA: "Market", wordB: "Mall", category: "Places", difficulty: "Medium", tags: ["shopping"] },
  { id: "places-06", wordA: "Temple", wordB: "Monument", category: "Places", difficulty: "Medium", tags: ["heritage"] },
  { id: "places-07", wordA: "Library", wordB: "Museum", category: "Places", difficulty: "Medium", tags: ["cultural"] },
  { id: "places-08", wordA: "Library", wordB: "Bookstore", category: "Places", difficulty: "Hard", tags: ["books"] },
  { id: "places-09", wordA: "Pharmacy", wordB: "Clinic", category: "Places", difficulty: "Hard", tags: ["health"] },
  { id: "places-10", wordA: "Gym", wordB: "Spa", category: "Places", difficulty: "Hard", tags: ["wellness"] },

  // Objects
  { id: "objects-01", wordA: "Toothbrush", wordB: "Comb", category: "Objects", difficulty: "Easy", tags: ["grooming"] },
  { id: "objects-02", wordA: "Scissors", wordB: "Stapler", category: "Objects", difficulty: "Easy", tags: ["stationery"] },
  { id: "objects-03", wordA: "Fridge", wordB: "Oven", category: "Objects", difficulty: "Easy", tags: ["kitchen-appliance"] },
  { id: "objects-04", wordA: "Backpack", wordB: "Suitcase", category: "Objects", difficulty: "Medium", tags: ["luggage"] },
  { id: "objects-05", wordA: "Umbrella", wordB: "Raincoat", category: "Objects", difficulty: "Medium", tags: ["rain-gear"] },
  { id: "objects-06", wordA: "Mirror", wordB: "Window", category: "Objects", difficulty: "Medium", tags: ["glass"] },
  { id: "objects-07", wordA: "Pillow", wordB: "Blanket", category: "Objects", difficulty: "Medium", tags: ["bedding"] },
  { id: "objects-08", wordA: "Violin", wordB: "Guitar", category: "Objects", difficulty: "Hard", tags: ["string-instrument"] },
  { id: "objects-09", wordA: "Pencil", wordB: "Crayon", category: "Objects", difficulty: "Hard", tags: ["drawing"] },
  { id: "objects-10", wordA: "Bottle", wordB: "Jar", category: "Objects", difficulty: "Hard", tags: ["container"] },
  { id: "objects-11", wordA: "Sponge", wordB: "Towel", category: "Objects", difficulty: "Hard", tags: ["absorbent"] },

  // Technology
  { id: "technology-01", wordA: "Keyboard", wordB: "Mouse", category: "Technology", difficulty: "Easy", tags: ["computer-accessory"] },
  { id: "technology-02", wordA: "Microphone", wordB: "Speaker", category: "Technology", difficulty: "Easy", tags: ["audio"] },
  { id: "technology-03", wordA: "Charger", wordB: "Headphones", category: "Technology", difficulty: "Easy", tags: ["phone-accessory"] },
  { id: "technology-04", wordA: "Robot", wordB: "Drone", category: "Technology", difficulty: "Medium", tags: ["machine"] },
  { id: "technology-05", wordA: "Camera", wordB: "Projector", category: "Technology", difficulty: "Medium", tags: ["visual-media"] },
  { id: "technology-06", wordA: "Laptop", wordB: "Tablet", category: "Technology", difficulty: "Medium", tags: ["portable-computer"] },
  { id: "technology-07", wordA: "Selfie", wordB: "Screenshot", category: "Technology", difficulty: "Medium", tags: ["phone-picture"] },
  { id: "technology-08", wordA: "Printer", wordB: "Scanner", category: "Technology", difficulty: "Hard", tags: ["office-device"] },
  { id: "technology-09", wordA: "Bluetooth", wordB: "Wifi", category: "Technology", difficulty: "Hard", tags: ["wireless"] },
  { id: "technology-10", wordA: "Emoji", wordB: "Sticker", category: "Technology", difficulty: "Hard", tags: ["chat-graphic"] },

  // Professions
  { id: "professions-01", wordA: "Firefighter", wordB: "Lifeguard", category: "Professions", difficulty: "Easy", tags: ["rescue"] },
  { id: "professions-02", wordA: "Farmer", wordB: "Fisherman", category: "Professions", difficulty: "Easy", tags: ["food-producer"] },
  { id: "professions-03", wordA: "Astronaut", wordB: "Sailor", category: "Professions", difficulty: "Easy", tags: ["explorer"] },
  { id: "professions-04", wordA: "Doctor", wordB: "Nurse", category: "Professions", difficulty: "Medium", tags: ["hospital"] },
  { id: "professions-05", wordA: "Engineer", wordB: "Architect", category: "Professions", difficulty: "Medium", tags: ["construction"] },
  { id: "professions-06", wordA: "Lawyer", wordB: "Judge", category: "Professions", difficulty: "Medium", tags: ["court"] },
  { id: "professions-07", wordA: "Chef", wordB: "Bartender", category: "Professions", difficulty: "Medium", tags: ["restaurant"] },
  { id: "professions-08", wordA: "Dentist", wordB: "Barber", category: "Professions", difficulty: "Medium", tags: ["chair-service"] },
  { id: "professions-09", wordA: "Chef", wordB: "Baker", category: "Professions", difficulty: "Hard", tags: ["cooking"] },
  { id: "professions-10", wordA: "Plumber", wordB: "Electrician", category: "Professions", difficulty: "Hard", tags: ["home-repair"] },
  { id: "professions-11", wordA: "Detective", wordB: "Spy", category: "Professions", difficulty: "Hard", tags: ["undercover"] },

  // College
  { id: "college-01", wordA: "Fest", wordB: "Exam", category: "College", difficulty: "Easy", tags: ["college-event"] },
  { id: "college-02", wordA: "Backbencher", wordB: "Topper", category: "College", difficulty: "Easy", tags: ["student-type"] },
  { id: "college-03", wordA: "Canteen", wordB: "Classroom", category: "College", difficulty: "Easy", tags: ["campus-spot"] },
  { id: "college-04", wordA: "Freshers", wordB: "Farewell", category: "College", difficulty: "Medium", tags: ["college-party"] },
  { id: "college-05", wordA: "Hostel", wordB: "Apartment", category: "College", difficulty: "Medium", tags: ["student-housing"] },
  { id: "college-06", wordA: "Principal", wordB: "Warden", category: "College", difficulty: "Medium", tags: ["authority"] },
  { id: "college-07", wordA: "Lecture", wordB: "Seminar", category: "College", difficulty: "Hard", tags: ["class-session"] },
  { id: "college-08", wordA: "Internship", wordB: "Placement", category: "College", difficulty: "Hard", tags: ["career"] },
  { id: "college-09", wordA: "Viva", wordB: "Presentation", category: "College", difficulty: "Hard", tags: ["assessment"] },
  { id: "college-10", wordA: "Scholarship", wordB: "Stipend", category: "College", difficulty: "Hard", tags: ["student-money"] },

  // Nature and geography
  { id: "nature-01", wordA: "Desert", wordB: "Rainforest", category: "Nature", difficulty: "Easy", tags: ["ecosystem"] },
  { id: "nature-02", wordA: "Sun", wordB: "Moon", category: "Nature", difficulty: "Easy", tags: ["sky"] },
  { id: "nature-03", wordA: "Snow", wordB: "Sand", category: "Nature", difficulty: "Easy", tags: ["ground-cover"] },
  { id: "nature-04", wordA: "Rainbow", wordB: "Lightning", category: "Nature", difficulty: "Easy", tags: ["sky", "weather"] },
  { id: "nature-05", wordA: "Mountain", wordB: "Volcano", category: "Nature", difficulty: "Medium", tags: ["landform"] },
  { id: "nature-06", wordA: "River", wordB: "Waterfall", category: "Nature", difficulty: "Medium", tags: ["flowing-water"] },
  { id: "nature-07", wordA: "Earthquake", wordB: "Tornado", category: "Nature", difficulty: "Medium", tags: ["natural-disaster"] },
  { id: "nature-08", wordA: "Rose", wordB: "Sunflower", category: "Nature", difficulty: "Medium", tags: ["flower"] },
  { id: "nature-09", wordA: "Glacier", wordB: "Iceberg", category: "Nature", difficulty: "Hard", tags: ["ice"] },
  { id: "nature-10", wordA: "Island", wordB: "Peninsula", category: "Nature", difficulty: "Hard", tags: ["land-and-sea"] },
  { id: "nature-11", wordA: "Coral", wordB: "Seaweed", category: "Nature", difficulty: "Hard", tags: ["underwater"] },

  // Transport
  { id: "transport-01", wordA: "Ship", wordB: "Train", category: "Transport", difficulty: "Easy", tags: ["passenger-transport"] },
  { id: "transport-02", wordA: "Rocket", wordB: "Submarine", category: "Transport", difficulty: "Easy", tags: ["extreme-vehicle"] },
  { id: "transport-03", wordA: "Ambulance", wordB: "Taxi", category: "Transport", difficulty: "Easy", tags: ["car-service"] },
  { id: "transport-04", wordA: "Car", wordB: "Motorcycle", category: "Transport", difficulty: "Medium", tags: ["road-vehicle"] },
  { id: "transport-05", wordA: "Helicopter", wordB: "Plane", category: "Transport", difficulty: "Medium", tags: ["aircraft"] },
  { id: "transport-06", wordA: "Truck", wordB: "Tractor", category: "Transport", difficulty: "Medium", tags: ["heavy-vehicle"] },
  { id: "transport-07", wordA: "Bus", wordB: "Tram", category: "Transport", difficulty: "Hard", tags: ["public-transport"] },
  { id: "transport-08", wordA: "Ferry", wordB: "Cruise", category: "Transport", difficulty: "Hard", tags: ["passenger-ship"] },
  { id: "transport-09", wordA: "Canoe", wordB: "Raft", category: "Transport", difficulty: "Hard", tags: ["paddle-boat"] },
  { id: "transport-10", wordA: "Elevator", wordB: "Escalator", category: "Transport", difficulty: "Hard", tags: ["building-transport"] },

  // Science
  { id: "science-01", wordA: "Fossil", wordB: "Crystal", category: "Science", difficulty: "Easy", tags: ["found-in-rock"] },
  { id: "science-02", wordA: "Thermometer", wordB: "Telescope", category: "Science", difficulty: "Easy", tags: ["instrument"] },
  { id: "science-03", wordA: "Skeleton", wordB: "Brain", category: "Science", difficulty: "Easy", tags: ["human-body"] },
  { id: "science-04", wordA: "Battery", wordB: "Bulb", category: "Science", difficulty: "Medium", tags: ["electric-circuit"] },
  { id: "science-05", wordA: "Lungs", wordB: "Heart", category: "Science", difficulty: "Medium", tags: ["organ"] },
  { id: "science-06", wordA: "Satellite", wordB: "Comet", category: "Science", difficulty: "Medium", tags: ["space-object"] },
  { id: "science-07", wordA: "Virus", wordB: "Bacteria", category: "Science", difficulty: "Hard", tags: ["germ"] },
  { id: "science-08", wordA: "Gravity", wordB: "Magnetism", category: "Science", difficulty: "Hard", tags: ["invisible-force"] },
  { id: "science-09", wordA: "Lens", wordB: "Prism", category: "Science", difficulty: "Hard", tags: ["optics"] },
  { id: "science-10", wordA: "Oxygen", wordB: "Hydrogen", category: "Science", difficulty: "Hard", tags: ["gas"] },

  // Everyday activities
  { id: "activities-01", wordA: "Laughing", wordB: "Crying", category: "Activities", difficulty: "Easy", tags: ["emotion"] },
  { id: "activities-02", wordA: "Singing", wordB: "Dancing", category: "Activities", difficulty: "Easy", tags: ["performing"] },
  { id: "activities-03", wordA: "Cooking", wordB: "Cleaning", category: "Activities", difficulty: "Easy", tags: ["household-chore"] },
  { id: "activities-04", wordA: "Camping", wordB: "Picnic", category: "Activities", difficulty: "Medium", tags: ["outdoor-leisure"] },
  { id: "activities-05", wordA: "Texting", wordB: "Calling", category: "Activities", difficulty: "Medium", tags: ["phone-communication"] },
  { id: "activities-06", wordA: "Fishing", wordB: "Hunting", category: "Activities", difficulty: "Medium", tags: ["catching-animals"] },
  { id: "activities-07", wordA: "Sneezing", wordB: "Coughing", category: "Activities", difficulty: "Hard", tags: ["reflex"] },
  { id: "activities-08", wordA: "Knitting", wordB: "Sewing", category: "Activities", difficulty: "Hard", tags: ["needlework"] },
  { id: "activities-09", wordA: "Yoga", wordB: "Meditation", category: "Activities", difficulty: "Hard", tags: ["mindfulness"] },
  { id: "activities-10", wordA: "Whistling", wordB: "Humming", category: "Activities", difficulty: "Hard", tags: ["wordless-tune"] },

  // Mixed: different domains, linked by one shared trait
  { id: "mixed-01", wordA: "Banana", wordB: "Moon", category: "Mixed", difficulty: "Easy", tags: ["crescent-shape"] },
  { id: "mixed-02", wordA: "Pizza", wordB: "Clock", category: "Mixed", difficulty: "Easy", tags: ["round", "divided"] },
  { id: "mixed-03", wordA: "Umbrella", wordB: "Mushroom", category: "Mixed", difficulty: "Easy", tags: ["dome-shape"] },
  { id: "mixed-04", wordA: "Zebra", wordB: "Piano", category: "Mixed", difficulty: "Medium", tags: ["black-and-white"] },
  { id: "mixed-05", wordA: "Key", wordB: "Password", category: "Mixed", difficulty: "Medium", tags: ["unlock"] },
  { id: "mixed-06", wordA: "Snake", wordB: "Rope", category: "Mixed", difficulty: "Medium", tags: ["long-and-coiled"] },
  { id: "mixed-07", wordA: "Cactus", wordB: "Porcupine", category: "Mixed", difficulty: "Medium", tags: ["spiky"] },
  { id: "mixed-08", wordA: "Candle", wordB: "Lighthouse", category: "Mixed", difficulty: "Medium", tags: ["light-in-the-dark"] },
  { id: "mixed-09", wordA: "Balloon", wordB: "Bubble", category: "Mixed", difficulty: "Hard", tags: ["round", "floats", "pops"] },
  { id: "mixed-10", wordA: "Shadow", wordB: "Reflection", category: "Mixed", difficulty: "Hard", tags: ["copy-of-you"] },
  { id: "mixed-11", wordA: "Snowman", wordB: "Scarecrow", category: "Mixed", difficulty: "Hard", tags: ["standing-figure"] }
];
