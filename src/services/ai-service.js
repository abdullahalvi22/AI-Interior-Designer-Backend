import OpenAI, { toFile } from 'openai';

const ROOM_ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    roomTypeEstimate: { type: 'string' },
    architecture: { type: 'array', items: { type: 'string' } },
    fixedElements: { type: 'array', items: { type: 'string' } },
    materials: { type: 'array', items: { type: 'string' } },
    lighting: { type: 'array', items: { type: 'string' } },
    spatialNotes: { type: 'array', items: { type: 'string' } },
    preservationRisks: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'roomTypeEstimate',
    'architecture',
    'fixedElements',
    'materials',
    'lighting',
    'spatialNotes',
    'preservationRisks',
  ],
};

export class AiService {
  constructor(config, client) {
    this.config = config.openai;
    this.client = client || new OpenAI({ apiKey: this.config.apiKey, maxRetries: 2, timeout: 300_000 });
  }

  async analyzeRoom({ buffer, contentType, userId }) {
    const imageUrl = `data:${contentType};base64,${buffer.toString('base64')}`;
    const result = await this.client.responses.create({
      model: this.config.visionModel,
      instructions: [
        'You are an architectural interior analysis system.',
        'Describe only visible facts and risks relevant to a geometry-preserving interior redesign.',
        'Do not invent dimensions or hidden features.',
      ].join(' '),
      input: [{
        role: 'user',
        content: [
          { type: 'input_text', text: 'Analyze this room for a photorealistic interior redesign.' },
          { type: 'input_image', image_url: imageUrl, detail: 'high' },
        ],
      }],
      text: {
        format: {
          type: 'json_schema',
          name: 'room_analysis',
          strict: true,
          schema: ROOM_ANALYSIS_SCHEMA,
        },
      },
      user: userId,
    }).withResponse();

    return {
      analysis: JSON.parse(result.data.output_text),
      requestId: result.request_id,
      usage: result.data.usage || null,
    };
  }

  async editRoom({ buffer, contentType, prompt, variants, quality, userId }) {
    const extension = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
    const image = await toFile(buffer, `original.${extension}`, { type: contentType });
    const request = {
      model: this.config.imageModel,
      image,
      prompt,
      n: variants,
      quality: quality === 'final' ? 'high' : 'low',
      size: this.config.imageSize,
      output_format: 'jpeg',
      output_compression: quality === 'final' ? 95 : 82,
      user: userId,
    };

    // GPT Image 2 always processes image inputs at high fidelity and rejects
    // requests that explicitly include the input_fidelity parameter.
    if (!/^gpt-image-2(?:-|$)/.test(this.config.imageModel)) {
      request.input_fidelity = 'high';
    }

    const result = await this.client.images.edit(request).withResponse();

    const images = (result.data.data || []).map((item) => {
      if (!item.b64_json) throw new Error('OpenAI returned an image without base64 data');
      return Buffer.from(item.b64_json, 'base64');
    });
    if (images.length !== variants) {
      throw new Error(`OpenAI returned ${images.length} of ${variants} requested variants`);
    }
    return {
      images,
      requestId: result.request_id,
      usage: result.data.usage || null,
    };
  }

  estimateCost(usageItems) {
    const usage = usageItems.filter(Boolean);
    if (!usage.length) return null;
    const inputTokens = usage.reduce((sum, item) => sum + Number(item.input_tokens || 0), 0);
    const outputTokens = usage.reduce((sum, item) => sum + Number(item.output_tokens || 0), 0);
    if (!this.config.inputCostPerMillionUsd && !this.config.outputCostPerMillionUsd) return null;
    return (
      inputTokens * this.config.inputCostPerMillionUsd
      + outputTokens * this.config.outputCostPerMillionUsd
    ) / 1_000_000;
  }
}
