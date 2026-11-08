// Chat safeguarding filter. Children use this chat, so the rules are deliberately strict.
//  - BLOCK (message is not posted, the attempt is logged): emails, phone numbers, links.
//  - MASK + FLAG: profanity and slurs (posted as ****, queued for super_admin review).
//  - FLAG (posted, queued for review): grooming-risk / personal-info phrases, bullying and wellbeing words.
// Matching runs on a normalised copy (lower case, common leetspeak undone, repeated letters squashed).

const LEET = { '0': 'o', '1': 'i', '!': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', '$': 's', '7': 't', '8': 'b' };
const normalise = s => s.toLowerCase()
  .replace(/[01!3@4$578]/g, c => LEET[c])
  .replace(/(.)\1{2,}/g, '$1$1');

const EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;
// 9+ digits allowing spaces, dots, dashes and brackets between them (UK/US phone shapes). Maths like "12 x 12 = 144" never hits this.
const PHONE = /(?:\+?\d[\s\-().]{0,2}){9,}/;
const LINK = /(https?:\/\/|www\.|\b[a-z0-9-]{2,}\.(com|net|org|co|uk|io|gg|me|tv|ly|xyz|app|link|site|online|info|biz|ru|cn)\b)/i;
const LINK_OK = /\b(www\.)?sumduel\.app\b/gi;

const PROFANITY = new RegExp('\\b(' + [
  'fuck\\w*', 'f+u+c+k+\\w*', 'fk', 'fck\\w*', 'shit\\w*', 'sh1t', 'bitch\\w*', 'cunt\\w*', 'dick(s|head\\w*)?', 'cock(s)?',
  'puss(y|ies)', 'wank\\w*', 'twat\\w*', 'bollock\\w*', 'bastard\\w*', 'arse(hole\\w*)?', 'ass(hole\\w*|es)?', 'slut\\w*',
  'whore\\w*', 'piss\\w*', 'crap', 'bugger\\w*', 'prick(s)?', 'nigg\\w*', 'fag(s|got\\w*)?', 'retard\\w*', 'spaz\\w*',
  'spastic\\w*', 'kike\\w*', 'chink(s)?', 'paki(s)?', 'coon(s)?', 'tranny', 'dyke(s)?', 'motherf\\w*', 'stfu', 'wtf',
].join('|') + ')\\b', 'gi');

const GROOMING = /\b(how old (are|r) (you|u)|what('?s| is) your (address|school|number|phone|snap\w*|insta\w*|surname|last name)|where (do|d) (you|u) live|which school|what school|send (me )?(a |ur |your )?(pic|pics|photo|photos|picture|selfie|vid|video)|snap ?chat|snap me|insta(gram)?|whats ?app|tik ?tok|discord|kik|telegram|roblox user|meet (up|me|irl)|in real life|keep (it|this) (a )?secret|our (little )?secret|don'?t tell (your |ur )?(mum|mom|mam|dad|parents?|anyone)|are (you|u) alone|home alone|webcam|video ?call|face ?time|private chat|dm me|add me on|boyfriend|girlfriend)\b/i;
const WELLBEING = /\b(kill (yourself|urself|ur self)|kys|go die|nobody likes (you|u)|everyone hates (you|u)|i hate (you|u)|hurt myself|cut myself|kill myself|want to die|suicide|self ?harm)\b/i;
const BULLYING = /\b(ugly|fat|stupid|idiot|loser|dumb|freak|weirdo|shut up)\b/i;

export const MAX_LEN = 300;

export function screen(raw) {
  const text = String(raw || '').replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e]/g, '').replace(/\s+/g, ' ').trim();
  if (!text) return { ok: false, reason: 'empty', message: 'Type a message first.' };
  if (text.length > MAX_LEN) return { ok: false, reason: 'too_long', message: `Keep it under ${MAX_LEN} characters.` };

  const forLinks = text.replace(LINK_OK, '');
  if (EMAIL.test(text)) return { ok: false, reason: 'email', message: 'Email addresses aren’t allowed in chat. Keep personal details private.' };
  if (PHONE.test(text)) return { ok: false, reason: 'phone', message: 'Phone numbers aren’t allowed in chat. Keep personal details private.' };
  if (LINK.test(forLinks)) return { ok: false, reason: 'link', message: 'Links aren’t allowed in chat.' };

  const flags = [];
  const norm = normalise(text);
  let out = text;
  PROFANITY.lastIndex = 0;
  if (PROFANITY.test(norm) || PROFANITY.test(text)) {
    flags.push('profanity');
    // Mask on the original where it matches directly; if only the normalised form matched, mask every word that normalises to a hit.
    out = text.split(/(\s+)/).map(w => {
      PROFANITY.lastIndex = 0;
      return /\s+/.test(w) ? w : (PROFANITY.test(normalise(w)) ? w[0] + '*'.repeat(Math.max(2, w.length - 1)) : w);
    }).join('');
  }
  if (GROOMING.test(norm)) flags.push('personal_info');
  if (WELLBEING.test(norm)) flags.push('wellbeing');
  else if (BULLYING.test(norm)) flags.push('unkind');
  return { ok: true, text: out, flags };
}
