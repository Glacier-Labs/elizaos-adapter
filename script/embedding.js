import axios   from 'axios'
import fs from 'fs'

const hf_token = process.env.HF_TOKEN;
async function getEmbeddingFromHF(input) {
    const embedding_url = "https://api-inference.huggingface.co/pipeline/feature-extraction/sentence-transformers/all-MiniLM-L6-v2"
    let response = await axios.post(embedding_url, {
      inputs: input,
    }, {
      headers: {
        'Authorization': `Bearer ${hf_token}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.status === 200) {
      return response.data;
    } else {
      throw new Error(`Failed to get embedding. Status code: ${response.status}`);
    }
  }

getEmbeddingFromHF("hello world").then((data) => {
    fs.writeFileSync("embedding.json", JSON.stringify(data));
})
