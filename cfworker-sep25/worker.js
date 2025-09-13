export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const secret = url.searchParams.get('secret');
      if (!secret || secret !== env.AUTH_SECRET) {
        return Response.redirect(env.redirect_url, 302);
      }

      if (request.method === 'GET') {
        return new Response(getHtml(), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }
 
      if (request.method === 'POST') {
        const formData = await request.formData();
        const model = String(formData.get('model') || '').trim();
        const queryRaw = String(formData.get('query') || '');
        if (!model || !queryRaw || queryRaw.length > 5000) {
          return new Response('Invalid input', { status: 400 });
        }
      
        const query = sanitize(queryRaw);
      
        let resultText = '';
        if (model === 'claude') {
          console.log('Selected model: Claude');
          resultText = await callClaude(query, env);
        } else if (model === 'deepseek') {
          console.log('Selected model: DeepSeek');
          resultText = await callDeepSeek(query, env);
        } else {
          console.log('Unknown model:', model);
          resultText = 'Unknown model selected';
        }
      
        // Check for search trigger based on keywords
        let finalText = resultText || '';
        if (typeof resultText === 'string' && shouldTriggerSearch(resultText)) {
          console.log('Search triggered by response:', resultText);
          const searchQuery = query;  // Use original query as search term
          const searchResults = await performSearch(searchQuery, env);
          console.log('Search results obtained:', searchResults);
          
          const enriched = `${query}\n\nSearch results:\n${searchResults}`;
          console.log('Enriched query for re-query:', enriched);
          
          const reQueryResult = model === 'claude' ? await callClaude(enriched, env) : await callDeepSeek(enriched, env);
          console.log('Re-query result:', reQueryResult);
          
          finalText = reQueryResult || 'Search completed, but no additional response from model.';
        }
      
        return new Response(escapeHtml(finalText), {
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      }
      
      
      // Add this new function after your existing ones
      function shouldTriggerSearch(responseText) {
        if (!responseText || typeof responseText !== 'string') return false;
        
        const lowerText = responseText.toLowerCase();
        const keywords = [
          "search:",
          "i don't have access",
          "i do not have access",
          "i'm unable to browse",
          "i can't browse",
          "i cannot browse",
          "unable to access",
          "there is no information",
          "no information available",
          "no knowledge of",
          "unable to provide",
          "can't find",
          "don't know",
          "cannot retrieve",
          "sorry, i don't have",
          "no data available"
        ];
      
        return keywords.some(k => lowerText.includes(k));
      }
      
      return new Response('Method not allowed', { status: 405 });
    } catch (err) {
      return new Response(`Error: ${escapeHtml(String(err?.message || err))}`, {
        status: 500,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }
  }
};

function getHtml() {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Chatbot</title>
      <style>
        body { background-color: black; color: white; font-family: Arial; }
        textarea { width: 100%; height: 200px; /* Fits ~200 words without scroll */ resize: vertical; overflow-y: auto; background: #333; color: white; border: 1px solid #666; }
        select, button { background: #333; color: white; border: 1px solid #666; }
        #response { margin-top: 20px; padding: 10px; background: #222; border: 1px solid #666; white-space: pre-wrap; }
      </style>
    </head>
    <body>
      <h1>Chatbot</h1>
      <form id="chatForm">
        <select name="model">
          <option value="claude">Claude Sonnet 4.1 Opus</option>
          <option value="deepseek">DeepSeek v3.1</option>
        </select>
        <br><br>
        <textarea name="query" placeholder="Enter your query..."></textarea>
        <br>
        <button type="submit">Send</button>
      </form>
      <div id="response"></div>
      <script>
        document.getElementById('chatForm').addEventListener('submit', async e => {
          e.preventDefault();
          const formData = new FormData(e.target);
          const response = await fetch(location.href, { method: 'POST', body: formData });
          const text = await response.text();
          document.getElementById('response').innerText = text;
        });
      </script>
    </body>
    </html>
  `;
}

function sanitize(input) {
  return input.replace(/[<>&"]/g, match => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[match]));
}

function escapeHtml(input) {
  return input.replace(/[<>&"]/g, match => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[match]));
}
async function callClaude(query, env) {
  const apiKey = env.CLAUDE_API_KEY;
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-opus-4-1-20250805',
      messages: [{ role: 'user', content: query }],
      max_tokens: 2000
    })
  });

  if (!response.ok) {
    const data = await response.json();
    return `Claude API error ${response.status}: ${data.error?.message || JSON.stringify(data)}`;
  }

  const data = await response.json();
  if (!Array.isArray(data.content) || data.content.length === 0) {
    return 'No response from Claude';
  }
  const textBlock = data.content.find(block => block.type === 'text' && typeof block.text === 'string');
  return textBlock ? textBlock.text : 'No response from Claude';
}

async function callDeepSeek(query, env) {
  console.log('callDeepSeek triggered with query:', query);
  const apiKey = env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    console.log('Missing DEEPSEEK_API_KEY');
    return 'DeepSeek API key missing or undefined';
  }

  try {
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: query }],
        max_tokens: 2000
      })
    });

    const textResponse = await response.text();
    let data = null;
    try {
      data = JSON.parse(textResponse);
    } catch (e) {
      console.log('DeepSeek JSON parse error:', e.message);
      return `DeepSeek response JSON parse error: ${e.message}`;
    }

    if (!response.ok) {
      const errMsg = data?.error?.message || data?.message || JSON.stringify(data);
      return `DeepSeek API error ${response.status}: ${errMsg}`;
    }

    if (!data || !Array.isArray(data.choices) || data.choices.length === 0) {
      console.log('DeepSeek response missing or empty choices:', data);
      return 'No response from DeepSeek';
    }

    if (!data.choices[0] || !data.choices[0].message) {
      console.log('DeepSeek missing message object:', data.choices[0]);
      return 'Unexpected DeepSeek response format (missing message)';
    }

    const content = data.choices[0].message.content;
    if (typeof content !== 'string') {
      console.log('DeepSeek content not a string:', content);
      return 'Unexpected DeepSeek response format (invalid content)';
    }

    return content;
  } catch (error) {
    console.log('DeepSeek call exception:', error.toString());
    return `DeepSeek call exception: ${error.toString()}`;
  }
}


async function performSearch(query, env) {
  const apiKey = env.TAVILY_API_KEY;
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey, query, search_depth: 'basic', max_results: 5 })
  });
  const data = await response.json();
  return data.results && data.results.length > 0 ? data.results.map(r => `${r.title}: ${r.content}`).join('\n') : 'No search results';
}
