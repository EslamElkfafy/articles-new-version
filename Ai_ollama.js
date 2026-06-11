/**
 * 🤖 Ai_ollama.js - Local Ollama Integration Module
 * 
 * 📝 هذا الملف هو بديل كامل لملف Ai.js الأساسي للمشروع.
 * يسمح لك بتشغيل المشروع بالكامل (استخراج البيانات الطبية) محلياً مجاناً وبدون حدود باستخدام Ollama
 * ونموذج qwen2.5-coder:7b.
 * 
 * 💡 طريقة التفعيل في المشروع:
 * في ملف getContent.js السطر رقم 8، قم بتغيير الاستدعاء من:
 *    const extractWithAI = require('./Ai');
 * إلى:
 *    const extractWithAI = require('./Ai_ollama');
 */

const axios = require('axios');

// إعدادات Ollama المحلي
const OLLAMA_URL = 'http://localhost:11434/api/chat';
const OLLAMA_MODEL = 'qwen2.5-coder:7b';

/**
 * دالة استخراج البيانات باستخدام نموذج Ollama المحلي
 * @param {string} cleanText - النص الكامل للبرومبت مع المقالة
 * @returns {Promise<string|null>} - النص المستخرج من النموذج (والذي يحتوي على الـ JSON)
 */
async function extractWithAI(cleanText) {
  let attempt = 0;
  const maxAttempts = 5;

  while (attempt < maxAttempts) {
    try {
      console.log(`    📡 [Ollama] Sending request to local model '${OLLAMA_MODEL}' (Attempt ${attempt + 1}/${maxAttempts})...`);
      
      const response = await axios.post(OLLAMA_URL, {
        model: OLLAMA_MODEL,
        messages: [
          {
            role: 'user',
            content: cleanText
          }
        ],
        options: {
          temperature: 0.1 // للحفاظ على دقة الالتزام بالـ JSON المطلوب
        },
        stream: false
      }, {
        timeout: 240000 // مهلة 4 دقائق للطلبات الطويلة أو الأجهزة المتوسطة
      });

      const content = response.data.message?.content;
      if (content) {
        console.log(`    ✅ [Ollama] Success with model: ${OLLAMA_MODEL}`);
        return content;
      }
      
      throw new Error("Empty response from Ollama");
    } catch (error) {
      attempt++;
      console.warn(`    ⚠️ [Ollama] Attempt ${attempt} failed. Error: ${error.message}`);
      
      if (attempt < maxAttempts) {
        // الانتظار قليلاً قبل إعادة المحاولة (مثلاً 5 ثوانٍ لإعطاء فرصة للمعالج ليرتاح)
        const waitTime = 5000;
        console.log(`    ⏳ Waiting ${waitTime / 1000}s before retrying...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }

  console.error('❌ [Ollama] All attempts failed to extract data using local Ollama model.');
  return null;
}

module.exports = extractWithAI;
