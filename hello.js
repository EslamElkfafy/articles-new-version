/**
 * Greets the world or a specific person.
 * Supports multiple languages.
 * Usage:
 *   node hello.js [name] [--lang language]
 * Example:
 *   node hello.js Alice --lang es
 */

const greetings = {
  en: 'Hello',
  es: 'Hola',
  fr: 'Bonjour',
  de: 'Guten Tag',
  it: 'Ciao',
  pt: 'Olá',
  ru: 'Привет',
  zh: '你好',
  jp: 'こんにちは',
  kr: '안녕하세요',
  ar: 'مرحبا',
  hi: 'नमस्ते',
};

function greet(name = 'World', lang = 'en') {
  const greeting = greetings[lang] || greetings['en'];
  const hour = new Date().getHours();
  let timeOfDay;
  if (hour < 12) timeOfDay = '🌅 Morning';
  else if (hour < 18) timeOfDay = '☀️ Afternoon';
  else timeOfDay = '🌙 Evening';

  const message = `${greeting}, ${name}!`;
  const timeMessage = `Good ${timeOfDay.replace(/🌅 |☀️ |🌙 /, '')} — it's currently ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}.`;

  return { message, timeMessage, timeOfDay };
}

function showUsage() {
  console.log('\nUsage: node hello.js [name] [--山庄 lang]');
  console.log('  name: Name to greet (default: "World")');
  console.log('  lang: Language code (default: "en")');
  console.log('\nAvailable languages:');
  Object.entries(greetings).forEach(([code, greeting]) => {
    console.log(`  ${code.padEnd(4)} → ${greeting}`);
  });
  console.log();
}

function main() {
  const args = process.argv.slice(2);
  let name = 'World';
  let lang = 'en';

  if (args.includes('--help') || args.includes('-h')) {
    showUsage();
    return;
  }

  // Parse arguments
  args.forEach((arg, index) => {
    if (arg === '--lang' && args[index + 1]) {
      lang = args[index + 1].toLowerCase();
    }
    // If it's not a flag, it's the name (take the first non-flag)
  });

  const nameCandidate = args.find(arg => !arg.startsWith('--') && !args[args.indexOf(arg) - 1]?.startsWith('--'));
  if (nameCandidate) {
    name = nameCandidate;
  }

  const { message, timeMessage, timeOfDay } = greet(name, lang);

  console.log('\n┌────────────────────────────────────┐');
  console.log(`│  ${message.padEnd(34)}│`);
  console.log(`│  ${timeMessage.padEnd(34)}│`);
  console.log(`│  ${timeOfDay.padEnd(34)}│`);
  console.log('└────────────────────────────────────┘\n');
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { greet, greetings };
