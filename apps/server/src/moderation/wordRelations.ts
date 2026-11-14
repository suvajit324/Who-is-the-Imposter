/**
 * Configurable relationship dictionary for the game's secret words.
 *
 *  - `aliases`  : synonyms, alternative names and translations (Hindi/Hinglish
 *                 transliterations for this player base). Saying one is as good as
 *                 saying the word, so they are blocked anywhere in a message.
 *  - `antonyms` : only matter in "opposite of ..." style hints.
 *  - `related`  : strong associations. Only blocked inside explicit hint phrasing
 *                 ("it's related to X", "think of X"). Ordinary discussion of related
 *                 ideas is the whole point of the discussion phase and stays allowed.
 *
 * Safety rule enforced at load time (see buildRelationIndex): no term may equal
 * ANY word in the word bank. Otherwise a player's own dictionary could block the
 * other secret word (e.g. a normal player typing the Imposter's word), which would
 * make guesses observable. Words without an entry still get every generic check.
 */

export type WordRelation = { aliases?: string[]; antonyms?: string[]; related?: string[] };

export const defaultWordRelations: Record<string, WordRelation> = {
  // Food
  coffee: { aliases: ["kaapi", "kapi", "kofi", "espresso", "cappuccino", "latte", "americano", "frappe", "mocha"], related: ["caffeine", "beans", "brew", "mug", "barista", "starbucks"] },
  tea: { aliases: ["chai", "chaay", "chaa", "masala chai", "green tea"], related: ["kettle", "teabag", "tea leaves", "leaves", "biscuit"] },
  cupcake: { aliases: ["fairy cake", "fairycake"], related: ["frosting", "icing", "sprinkles", "muffin", "cake"] },
  donut: { aliases: ["doughnut", "doughnuts"], related: ["glazed", "sprinkles", "hole", "ring"] },
  mango: { aliases: ["aam", "aamras", "alphonso", "hapus", "aam ras"], related: ["pulp", "king of fruits", "summer fruit"] },
  pineapple: { aliases: ["ananas", "ananaas"], related: ["spiky", "tropical", "pina colada"] },
  pancake: { aliases: ["hotcake", "hotcakes", "flapjack", "flapjacks"], related: ["syrup", "maple", "flip", "stack", "crepe"] },
  waffle: { aliases: [], related: ["grid", "belgian", "syrup", "squares"] },
  pasta: { aliases: ["spaghetti", "penne", "macaroni", "fusilli", "lasagna", "lasagne", "ravioli", "fettuccine"], related: ["italian", "al dente", "alfredo", "arrabbiata"] },
  noodles: { aliases: ["ramen", "chowmein", "chow mein", "maggi", "hakka", "udon", "lo mein", "noodle"], related: ["chopsticks", "instant", "two minute"] },
  pizza: { aliases: ["margherita", "pizzeria", "pizzahut", "pizza hut"], related: ["dominos", "slice", "crust", "toppings", "cheese burst", "oven"] },
  burger: { aliases: ["hamburger", "cheeseburger", "whopper", "aloo tikki burger"], related: ["patty", "bun", "mcdonalds", "fries"] },
  sushi: { aliases: ["maki", "nigiri", "sashimi"], related: ["wasabi", "seaweed", "raw fish", "japanese", "chopsticks"] },
  taco: { aliases: ["tacos"], related: ["tortilla", "mexican", "salsa", "nachos"] },

  // Animals
  crocodile: { aliases: ["croc", "magarmach", "magarmachh", "magar"], related: ["reptile", "jaws", "swamp", "river"] },
  alligator: { aliases: ["gator", "gators"], related: ["reptile", "swamp", "florida"] },
  dolphin: { aliases: ["porpoise"], related: ["flipper", "clicks", "intelligent", "ocean"] },
  whale: { aliases: ["moby", "humpback", "orca", "blue whale"], related: ["blowhole", "blubber", "biggest animal"] },
  eagle: { aliases: ["garud", "garuda", "cheel"], related: ["bald", "talons", "soar", "national bird of usa"] },
  falcon: { aliases: ["shaheen", "baaz", "baz"], related: ["peregrine", "falconry", "fastest bird"] },
  horse: { aliases: ["ghoda", "ghora", "ghodaa", "stallion", "mare", "pony", "steed", "colt", "foal"], related: ["saddle", "gallop", "hooves", "jockey", "neigh", "horsepower"] },
  donkey: { aliases: ["gadha", "gadhaa", "gadhe", "burro"], related: ["bray", "eeyore", "hee haw", "mule"] },
  lion: { aliases: ["sher", "sheer", "simba", "lioness", "babbar sher"], related: ["mane", "roar", "pride", "king of the jungle", "jungle king"] },
  tiger: { aliases: ["bagh", "baagh", "tigress", "sher khan", "shere khan"], related: ["stripes", "striped", "bengal", "roar"] },
  penguin: { aliases: ["pingu"], related: ["antarctica", "waddle", "tuxedo", "emperor"] },
  seal: { aliases: ["sea lion", "sealion"], related: ["flippers", "clap", "arctic"] },
  rabbit: { aliases: ["bunny", "bunnies", "khargosh", "khargosh", "khargos", "hare"], related: ["carrot", "hop", "burrow", "easter"] },
  hamster: { aliases: ["gerbil"], related: ["wheel", "cage", "cheeks", "rodent"] },

  // Sports
  basketball: { aliases: ["hoops", "nba"], related: ["dribble", "dunk", "hoop", "slam dunk", "jordan"] },
  volleyball: { aliases: [], related: ["spike", "net", "set", "dig"] },
  boxing: { aliases: ["boxer", "pugilism"], related: ["gloves", "punch", "ring", "knockout", "tyson"] },
  wrestling: { aliases: ["kushti", "wrestler", "wwe", "dangal", "pehlwani", "pehelwani"], related: ["pin", "mat", "smackdown", "cena"] },
  chess: { aliases: ["shatranj"], related: ["checkmate", "pawn", "bishop", "knight", "rook", "grandmaster"] },
  carrom: { aliases: ["caroms", "carromboard", "carrom board"], related: ["striker", "coins", "pocket", "queen"] },
  cricket: { aliases: ["ipl", "odi", "t20", "test match"], related: ["bat", "wicket", "stumps", "bowler", "sixer", "kohli", "dhoni", "sachin"] },
  baseball: { aliases: ["mlb"], related: ["pitcher", "home run", "homerun", "innings", "babe ruth"] },
  football: { aliases: ["soccer", "fifa", "futbol"], related: ["goal", "messi", "ronaldo", "penalty", "striker"] },
  rugby: { aliases: [], related: ["scrum", "try", "tackle", "oval ball", "all blacks"] },
  swimming: { aliases: ["swimmer", "tairaki", "tairna"], related: ["pool", "freestyle", "goggles", "laps", "phelps"] },
  diving: { aliases: ["diver", "scuba"], related: ["springboard", "plunge", "snorkel", "oxygen tank"] },
  tennis: { aliases: ["lawn tennis", "wimbledon"], related: ["racket", "racquet", "serve", "deuce", "federer", "nadal"] },
  badminton: { aliases: ["shuttle", "shuttlecock", "birdie"], related: ["racket", "racquet", "smash", "saina", "sindhu"] },

  // Movies
  cinema: { aliases: ["multiplex", "movie hall", "picture hall", "talkies", "pvr", "inox"], related: ["popcorn", "screen", "tickets", "film", "movies"] },
  theatre: { aliases: ["theater", "playhouse", "natak", "rangmanch"], related: ["stage", "curtain", "play", "drama", "actors"] },
  comedy: { aliases: ["comic", "standup", "stand up", "comedian", "hasya"], antonyms: ["tragedy"], related: ["jokes", "funny", "laughter", "humour", "humor"] },
  sitcom: { aliases: ["situation comedy"], related: ["laugh track", "episodes", "friends", "office"] },
  director: { aliases: ["filmmaker", "film maker", "nirdeshak"], related: ["action", "cut", "clapboard", "rajamouli"] },
  producer: { aliases: ["financier", "nirmata"], related: ["budget", "funding", "money"] },
  hero: { aliases: ["protagonist", "nayak", "superhero"], related: ["saves the day", "cape", "brave"] },
  villain: { aliases: ["antagonist", "baddie", "bad guy", "khalnayak", "khalnayak"], related: ["evil", "gabbar", "henchmen"] },
  sequel: { aliases: ["part two", "part 2", "follow up"], antonyms: ["prequel"], related: ["continuation", "franchise", "part one"] },
  remake: { aliases: ["reboot", "redo"], antonyms: ["original"], related: ["version", "copy"] },
  soundtrack: { aliases: ["ost", "bgm", "background music", "background score"], related: ["album", "songs", "score", "music"] },
  playlist: { aliases: ["mixtape", "mix tape"], related: ["spotify", "songs", "shuffle", "queue"] },
  trailer: { aliases: ["preview", "promo"], related: ["release date", "glimpse", "first look"] },
  teaser: { aliases: ["sneak peek", "promo"], related: ["glimpse", "short clip", "first look"] },

  // Places
  airport: { aliases: ["aerodrome", "airfield", "hawai adda", "hawaai adda"], related: ["flights", "runway", "boarding", "terminal", "check in"] },
  station: { aliases: ["railway station", "terminus", "stesan"], related: ["trains", "platform", "tracks", "junction"] },
  beach: { aliases: ["seashore", "seaside", "samundar kinara", "sea shore"], related: ["sand", "waves", "coast", "shore", "goa"] },
  island: { aliases: ["isle", "islet", "dweep", "atoll"], related: ["surrounded by water", "andaman", "castaway"] },
  hostel: { aliases: ["hostels"], related: ["warden", "roommate", "mess", "curfew"] },
  dormitory: { aliases: ["dorm", "dorms"], related: ["bunk beds", "roommate"] },
  apartment: { aliases: ["condo"], related: ["flat", "rent", "society", "building"] },
  library: { aliases: ["pustakalaya"], related: ["books", "librarian", "silence", "borrow"] },
  bookstore: { aliases: ["bookshop", "book shop"], related: ["buy books", "bestsellers"] },
  market: { aliases: ["bazaar", "bazar", "mandi", "haat"], related: ["vendors", "bargain", "sabzi"] },
  mall: { aliases: ["shopping centre", "shopping center", "shopping mall"], related: ["escalator", "food court", "shops", "plaza"] },
  mountain: { aliases: ["parvat", "pahad", "pahaad"], antonyms: ["valley"], related: ["everest", "himalaya", "himalayas", "summit", "peak"] },
  hill: { aliases: ["pahadi", "hillock", "tila"], antonyms: ["valley"], related: ["slope", "small mountain", "hill station"] },
  museum: { aliases: ["sangrahalay", "sangrahalaya"], related: ["exhibits", "artifacts", "history", "dinosaur"] },
  gallery: { aliases: ["art gallery"], related: ["paintings", "art", "exhibition"] },
  temple: { aliases: ["mandir", "devalaya", "shrine"], related: ["pooja", "puja", "god", "prasad", "aarti"] },
  monument: { aliases: ["memorial", "smarak"], related: ["taj mahal", "heritage", "qutub minar"] },

  // Objects
  backpack: { aliases: ["rucksack", "knapsack", "school bag", "schoolbag"], related: ["straps", "bag"] },
  suitcase: { aliases: ["luggage", "baggage", "trolley bag"], related: ["travel", "packing", "wheels"] },
  key: { aliases: ["chabi", "chaabi", "chaavi", "chavi"], related: ["lock", "keychain", "unlock"] },
  password: { aliases: ["passcode", "passwd", "pwd"], related: ["login", "secret", "pin", "hacker"] },
  passkey: { aliases: [], related: ["biometric", "fingerprint", "face id"] },
  laptop: { aliases: ["macbook", "thinkpad"], related: ["portable", "charger", "computer"] },
  tablet: { aliases: ["ipad"], related: ["touchscreen", "stylus", "tab"] },
  mirror: { aliases: ["aaina", "aina", "aaeena", "darpan", "looking glass"], related: ["reflection", "selfie"] },
  window: { aliases: ["khidki", "khidkee", "khirki"], related: ["glass", "curtains", "frame", "view"] },
  notebook: { aliases: ["notepad", "exercise book"], related: ["copy", "pages", "write"] },
  diary: { aliases: ["journal"], related: ["dear diary", "secrets", "daily"] },
  umbrella: { aliases: ["chhata", "chhatri", "chatri", "chata", "chhaata", "brolly"], related: ["rain", "monsoon"] },
  raincoat: { aliases: ["mackintosh", "poncho", "barsati"], related: ["rain", "monsoon", "waterproof"] },
  wallet: { aliases: ["batua", "billfold"], related: ["cash", "cards", "money"] },
  purse: { aliases: ["handbag", "clutch", "batua"], related: ["lipstick", "ladies"] },

  // Technology
  browser: { aliases: ["chrome", "firefox", "safari", "opera"], related: ["tabs", "internet", "web", "incognito"] },
  search: { aliases: ["google", "lookup", "look up", "bing"], related: ["results", "query"] },
  camera: { aliases: ["dslr", "webcam"], related: ["photos", "lens", "click", "cam"] },
  scanner: { aliases: ["xerox"], related: ["barcode", "document", "scan"] },
  keyboard: { aliases: ["qwerty"], related: ["keys", "typing"] },
  mouse: { aliases: ["chuha", "chooha", "chuhaa"], related: ["click", "scroll", "cursor", "cheese"] },
  robot: { aliases: ["android", "droid", "cyborg", "automaton"], related: ["ai", "machine", "bot", "metal"] },
  drone: { aliases: ["quadcopter", "uav"], related: ["propellers", "flying"] },
  server: { aliases: ["backend", "mainframe"], antonyms: ["client"], related: ["hosting", "data center", "rack"] },
  cloud: { aliases: ["aws", "azure", "icloud", "gcp", "badal", "baadal"], related: ["storage", "sky"] },

  // College
  assignment: { aliases: ["homework", "hw"], related: ["deadline", "submission"] },
  project: { aliases: ["mini project", "capstone"], related: ["team", "presentation"] },
  canteen: { aliases: ["tuck shop"], related: ["samosa", "mess", "chai"] },
  cafeteria: { aliases: ["caf", "food court"], related: ["trays", "lunch", "cafe"] },
  exam: { aliases: ["examination", "pariksha", "midsem", "endsem", "midterm", "finals"], related: ["test", "paper", "marks", "invigilator"] },
  quiz: { aliases: ["quizzes"], related: ["questions", "buzzer", "trivia"] },
  freshers: { aliases: ["fresher", "freshie", "freshies", "freshman", "freshmen", "first years"], antonyms: ["farewell party"], related: ["welcome party", "ragging"] },
  farewell: { aliases: ["send off", "sendoff", "goodbye party", "alvida"], antonyms: ["welcome"], related: ["seniors", "goodbye"] },
  internship: { aliases: ["intern", "interns", "trainee"], related: ["stipend", "summer"] },
  placement: { aliases: ["placements", "campus placement", "campus recruitment"], related: ["package", "lpa", "ctc", "offer letter"] },
  lecture: { aliases: ["lec"], related: ["class", "notes", "attendance"] },
  seminar: { aliases: ["workshop", "webinar", "symposium"], related: ["presentation", "speaker"] },

  // Professions
  chef: { aliases: ["khansama", "rasoiya"], related: ["cook", "kitchen", "recipe", "apron"] },
  baker: { aliases: ["patissier"], related: ["bread", "oven", "bakery"] },
  doctor: { aliases: ["physician", "daktar", "vaidya"], antonyms: ["patient"], related: ["stethoscope", "hospital", "prescription", "doc"] },
  nurse: { aliases: ["caregiver"], antonyms: ["patient"], related: ["injection", "ward", "hospital", "sister"] },
  engineer: { aliases: ["engg"], related: ["btech", "iit", "techie"] },
  architect: { aliases: ["vastukar"], related: ["blueprint", "buildings", "design"] },
  lawyer: { aliases: ["advocate", "attorney", "vakil", "wakil", "barrister", "solicitor"], related: ["court", "case", "lawsuit"] },
  judge: { aliases: ["magistrate", "nyayadhish"], antonyms: ["accused"], related: ["court", "gavel", "verdict", "justice", "order order"] },
  pilot: { aliases: ["aviator"], related: ["cockpit", "plane", "flying"] },
  captain: { aliases: ["skipper", "kaptaan", "kaptan", "capt"], related: ["ship", "armband", "leader"] },
  teacher: { aliases: ["tutor", "educator", "shikshak", "adhyapak"], antonyms: ["student"], related: ["classroom", "blackboard", "guru"] },
  professor: { aliases: ["prof", "lecturer"], antonyms: ["student"], related: ["university", "phd"] }
};
