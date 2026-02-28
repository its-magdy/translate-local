# TranslateGemma — Research Notes

> Source: https://blog.google/innovation-and-ai/technology/developers-tools/translategemma/

## What It Is

TranslateGemma is Google's open-source translation model family built on Gemma 3. Released January 2026.

## Model Sizes

- **4B** — lightweight, fast inference, good for on-device/edge
- **12B** — balanced quality and speed (recommended default)
- **27B** — highest quality, needs more compute

All available on: Kaggle, Vertex AI (Google Cloud), and via Ollama locally

## Language Support

- **55 core languages** with benchmark coverage
- **~500 additional language pairs** trained but not benchmarked
- Fine-tunable for low-resource languages via LoRA/QLoRA (PEFT)

## How to Run

### Local (Ollama)
```bash
ollama run translate-gemma-12b
```

### Vertex AI (Google Cloud)
Managed deployment with autoscaling and private endpoints. Best if already on GCP.

## Glossary Approach

TranslateGemma's recommended glossary workflow:

1. **Pre-mark** product names and key terms with XML tags in the prompt
2. **Post-check** output with a glossary matcher to catch drift
3. Example: tag "Sign in" so the model doesn't translate it as "Log in"

```
Translate the following from English to Arabic.
Preserve terms marked with <term> tags using their specified translations.

Source: The <term translation="واجهة برمجة">API</term> is ready for use.
```

## Fine-Tuning

- Use PEFT (Parameter-Efficient Fine-Tuning) for domain adaptation
- LoRA and QLoRA are effective for translation tasks
- Useful for: low-resource languages, domain-specific terminology, style preferences

## Key Links

- Blog: https://blog.google/innovation-and-ai/technology/developers-tools/translategemma/
- WaveSpeed explainer: https://wavespeed.ai/blog/posts/what-is-translategemma/
