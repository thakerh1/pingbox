'use strict';

// ─── Levenshtein distance ───────────────────────────────────────────
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => (j === 0 ? i : 0)));
  for (let j = 1; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

// ─── Damerau-Levenshtein (optimal string alignment) ──────────────────
// Same as Levenshtein but treats an adjacent-character transposition
// (the single most common human typo — "jhon"/"john", "hotamil"/"hotmail")
// as one edit instead of two, so real typos score closer and bogus
// "corrections" of unrelated words score farther away.
function damerauLevenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1);
      }
    }
  }
  return dp[m][n];
}

// Common email domains people typo most often.
const KNOWN_DOMAINS = [
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'aol.com',
  'mail.com', 'protonmail.com', 'live.com', 'msn.com', 'me.com', 'mac.com',
  'googlemail.com', 'ymail.com', 'yahoo.co.uk', 'yahoo.co.in', 'zoho.com'
];

// A modest dictionary of common local-part words: role addresses plus a
// broad (not exhaustive) set of common first names. This is meant to catch
// the obvious "jhon" -> "john" / "suport" -> "support" typos, not to be a
// complete name database.
const COMMON_LOCAL_WORDS = [
  'info', 'support', 'admin', 'help', 'contact', 'sales', 'noreply', 'webmaster',
  'postmaster', 'abuse', 'hello', 'office', 'team', 'feedback', 'marketing',
  'billing', 'security', 'legal', 'privacy', 'newsletter', 'careers', 'jobs',
  'press', 'media', 'events', 'news', 'service', 'services', 'enquiry', 'enquiries',
  'james', 'john', 'robert', 'michael', 'william', 'david', 'richard', 'joseph',
  'thomas', 'charles', 'christopher', 'daniel', 'matthew', 'anthony', 'mark',
  'donald', 'steven', 'andrew', 'paul', 'joshua', 'kenneth', 'kevin', 'brian',
  'george', 'edward', 'ronald', 'timothy', 'jason', 'jeffrey', 'ryan', 'jacob',
  'gary', 'nicholas', 'eric', 'jonathan', 'stephen', 'larry', 'justin', 'scott',
  'brandon', 'benjamin', 'samuel', 'frank', 'gregory', 'raymond', 'alexander',
  'patrick', 'jack', 'dennis', 'jerry', 'tyler', 'aaron', 'jose', 'henry', 'adam',
  'douglas', 'nathan', 'peter', 'zachary', 'kyle', 'walter', 'harold', 'jeremy',
  'ethan', 'carl', 'keith', 'roger', 'gerald', 'christian', 'terry', 'sean',
  'arthur', 'austin', 'noah', 'lawrence', 'jesse', 'joe', 'bryan', 'billy',
  'jordan', 'albert', 'dylan', 'bruce', 'willie', 'gabriel', 'alan', 'juan',
  'logan', 'wayne', 'ralph', 'mary', 'patricia', 'jennifer', 'linda', 'elizabeth',
  'barbara', 'susan', 'jessica', 'sarah', 'karen', 'lisa', 'nancy', 'betty',
  'margaret', 'sandra', 'ashley', 'kimberly', 'emily', 'donna', 'michelle',
  'dorothy', 'carol', 'amanda', 'melissa', 'deborah', 'stephanie', 'rebecca',
  'laura', 'sharon', 'cynthia', 'kathleen', 'amy', 'shirley', 'angela', 'helen',
  'anna', 'brenda', 'pamela', 'nicole', 'samantha', 'katherine', 'emma', 'ruth',
  'christine', 'catherine', 'debra', 'rachel', 'carolyn', 'janet', 'virginia',
  'maria', 'heather', 'diane', 'julie', 'joyce', 'victoria', 'kelly', 'christina',
  'joan', 'evelyn', 'olivia', 'judith', 'megan', 'andrea', 'cheryl', 'hannah',
  'jacqueline', 'martha', 'gloria', 'teresa', 'sara', 'julia', 'marie', 'madison',
  'grace', 'judy', 'theresa', 'beverly', 'denise', 'marilyn', 'amber', 'danielle',
  'abigail', 'brittany', 'rose', 'diana', 'natalie', 'sophia', 'jane', 'ann',
  // Common surnames — local-part correction was missing this category almost
  // entirely (e.g. "jane.doe" was getting "corrected" into "janet.joe"
  // because neither "jane" nor "doe" were recognized words). Top US Census
  // surnames, abbreviated.
  'smith', 'johnson', 'williams', 'brown', 'jones', 'garcia', 'miller', 'davis',
  'rodriguez', 'martinez', 'hernandez', 'lopez', 'gonzalez', 'wilson', 'anderson',
  'thomas', 'taylor', 'moore', 'jackson', 'martin', 'lee', 'perez', 'thompson',
  'white', 'harris', 'sanchez', 'clark', 'ramirez', 'lewis', 'robinson', 'walker',
  'young', 'allen', 'king', 'wright', 'scott', 'torres', 'nguyen', 'hill', 'flores',
  'green', 'adams', 'nelson', 'baker', 'hall', 'rivera', 'campbell', 'mitchell',
  'carter', 'roberts', 'gomez', 'phillips', 'evans', 'turner', 'diaz', 'parker',
  'cruz', 'edwards', 'collins', 'reyes', 'stewart', 'morris', 'morales', 'murphy',
  'cook', 'rogers', 'gutierrez', 'ortiz', 'morgan', 'cooper', 'peterson', 'bailey',
  'reed', 'kelly', 'howard', 'ramos', 'kim', 'cox', 'ward', 'richardson', 'watson',
  'brooks', 'chavez', 'wood', 'bennett', 'gray', 'mendoza', 'ruiz', 'hughes',
  'price', 'alvarez', 'castillo', 'sanders', 'patel', 'myers', 'long', 'ross',
  'foster', 'jimenez', 'powell', 'jenkins', 'perry', 'russell', 'sullivan', 'bell',
  'coleman', 'butler', 'henderson', 'barnes', 'gonzales', 'fisher', 'vasquez',
  'simmons', 'romero', 'patterson', 'alexander', 'hamilton', 'graham', 'reynolds',
  'griffin', 'wallace', 'moreno', 'west', 'cole', 'hayes', 'bryant', 'herrera',
  'gibson', 'ellis', 'tran', 'medina', 'aguilar', 'stevens', 'murray', 'ford',
  'castro', 'marshall', 'owens', 'harrison', 'fernandez', 'mcdonald', 'woods',
  'washington', 'kennedy', 'wells', 'vargas', 'henry', 'chen', 'freeman', 'webb',
  'tucker', 'guzman', 'burns', 'crawford', 'olson', 'simpson', 'porter', 'hunter',
  'gordon', 'mendez', 'silva', 'shaw', 'snyder', 'mason', 'dixon', 'munoz', 'hunt',
  'hicks', 'holmes', 'palmer', 'wagner', 'black', 'robertson', 'boyd', 'stone',
  'salazar', 'fox', 'warren', 'mills', 'meyer', 'rice', 'schmidt', 'garza',
  'daniels', 'ferguson', 'nichols', 'stephens', 'soto', 'weaver', 'gardner',
  'payne', 'grant', 'dunn', 'kelley', 'spencer', 'hawkins', 'arnold', 'pierce',
  'vazquez', 'hansen', 'peters', 'santos', 'hart', 'bradley', 'knight', 'elliott',
  'cunningham', 'duncan', 'armstrong', 'hudson', 'carroll', 'lane', 'riley',
  'andrews', 'alvarado', 'ray', 'delgado', 'berry', 'perkins', 'hoffman',
  'johnston', 'matthews', 'pena', 'richards', 'contreras', 'willis', 'carpenter',
  'sandoval', 'guerrero', 'chapman', 'rios', 'estrada', 'ortega', 'watkins',
  'greene', 'nunez', 'wheeler', 'valdez', 'harper', 'burke', 'larson', 'santiago',
  'maldonado', 'morrison', 'franklin', 'carlson', 'dominguez', 'carr', 'lawson',
  'jacobs', 'obrien', 'lynch', 'singh', 'vega', 'bishop', 'montgomery', 'oliver',
  'jensen', 'harvey', 'williamson', 'gilbert', 'dean', 'sims', 'espinoza',
  'howell', 'wong', 'reid', 'hanson', 'mccoy', 'garrett', 'burton', 'fuller', 'doe'
];

// Finds the closest dictionary entry within maxDist edits. Returns null if
// `word` is already an exact match (no correction needed) or nothing is
// close enough to be a confident suggestion. Requires a clear, unambiguous
// winner — if two dictionary words tie for closest, that's exactly the
// "is this really smith, or did they mean keith?" situation we can't
// resolve safely, so we refuse to guess rather than risk corrupting a
// perfectly valid (just uncommon) name.
function nearestMatch(word, dictionary, maxDist) {
  let best = null, bestDist = Infinity, tie = false;
  for (const candidate of dictionary) {
    if (candidate === word) return null;
    const dist = damerauLevenshtein(word, candidate);
    if (dist > maxDist) continue;
    if (dist < bestDist) { bestDist = dist; best = candidate; tie = false; }
    else if (dist === bestDist) { tie = true; }
  }
  return tie ? null : best;
}

// Known domains are short (me.com is 6 chars), so a flat "distance <= 2"
// threshold is far too loose — it happily "corrects" a real domain like
// acme.com into me.com (distance 2 = deleting just "ac"). Scale the
// allowance down for short domains instead.
function correctDomain(domain) {
  const d = domain.toLowerCase();
  const maxDist = d.length <= 9 ? 1 : 2;
  return nearestMatch(d, KNOWN_DOMAINS, maxDist);
}

// Corrects the local part token-by-token, splitting on '.' / '+' so
// "jhon.smith" -> "john.smith" without mangling the separator. Distance
// is capped at 1 — our name dictionary is necessarily incomplete (it
// can't contain every real surname), so anything looser starts
// "correcting" valid-but-uncommon names into unrelated dictionary words.
function correctLocalPart(local) {
  const tokens = local.split(/([.+])/); // keep separators as their own tokens
  let changed = false;
  const corrected = tokens.map(tok => {
    if (tok === '.' || tok === '+' || !tok) return tok;
    const fix = nearestMatch(tok.toLowerCase(), COMMON_LOCAL_WORDS, 1);
    if (fix) { changed = true; return fix; }
    return tok;
  });
  return changed ? corrected.join('') : null;
}

// Returns a corrected email string, or null if no correction was found.
// The caller is responsible for re-validating the candidate.
function suggestTypoCorrection(email) {
  const trimmed = String(email || '').trim().toLowerCase();
  const at = trimmed.lastIndexOf('@');
  if (at === -1) return null;
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  if (!local || !domain) return null;

  const domainFix = correctDomain(domain);
  const localFix = correctLocalPart(local);
  if (!domainFix && !localFix) return null;

  const candidate = `${localFix || local}@${domainFix || domain}`;
  return candidate === trimmed ? null : candidate;
}

module.exports = { levenshtein, damerauLevenshtein, suggestTypoCorrection, KNOWN_DOMAINS, COMMON_LOCAL_WORDS };
