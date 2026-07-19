const Groq = require('groq-sdk');
const groq = new Groq({ apiKey: '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' });
async function main() {
  try {
    const models = await groq.models.list();
    console.log(models.data.map(m => m.id).join('\n'));
  } catch (e) {
    console.log(e);
  }
}
main();
