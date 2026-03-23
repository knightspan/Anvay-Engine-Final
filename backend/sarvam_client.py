import requests, base64, os
from dotenv import load_dotenv

load_dotenv()

class SarvamClient:
    def __init__(self):
        self.key  = os.getenv("SARVAM_API_KEY", "")
        self.base = "https://api.sarvam.ai"

    def _headers(self):
        return {
            "Authorization": f"Bearer {self.key}",
            "api-subscription-key": self.key, 
            "Content-Type":  "application/json"
        }

    def generate(self, system: str, user: str, max_tokens: int = 1200) -> str:
        """Call Sarvam LLM for text generation."""
        if not self.key or self.key == "paste_your_sarvam_key_here":
            return self._graph_fallback(user)

        payload = {
            "model": "sarvam-m",
            "messages": [
                {"role": "system", "content": system},
                {"role": "user",   "content": user[:5000]}
            ],
            "max_tokens": max_tokens,
            "temperature": 0.25
        }
        try:
            r = requests.post(
                f"{self.base}/v1/chat/completions",
                json=payload, headers=self._headers(), timeout=45
            )
            r.raise_for_status()
            return r.json()["choices"][0]["message"]["content"]
        except Exception as ex:
            print(f"[Sarvam LLM error] {ex}")
            return self._graph_fallback(user)

    def _graph_fallback(self, context: str) -> str:
        """Deterministic response from graph context if API unavailable."""
        lines = [
            l.strip() for l in context.split("\n")
            if any(k in l for k in ["Path","Bridge","summary","ALERT","Chain"])
            and l.strip()
        ]
        out = ["Based on ANVAY graph analysis:\n"]
        for l in lines[:10]:
            out.append(f"• {l}")
        out.append(
            "\n[Note: Response generated from graph traversal context.]\n"
            "CONFIDENCE SCORE: 0.65"
        )
        return "\n".join(out)

    def transcribe(self, audio_bytes: bytes, language: str = "hi-IN") -> str:
        """Speech to text."""
        if not self.key or self.key == "paste_your_sarvam_key_here":
            return ""
        
        headers = {"api-subscription-key": self.key}
        files   = {"file": ("audio.wav", audio_bytes, "audio/wav")}
        data    = {"language_code": language, "model": "saarika:v2.5"} 
        
        try:
            r = requests.post(
                f"{self.base}/speech-to-text/transcribe",
                files=files, data=data, headers=headers, timeout=30
            )
            r.raise_for_status()
            return r.json().get("transcript", "")
        except Exception as ex:
            print(f"[Sarvam STT error] {ex}")
            return ""

    def synthesize(self, text: str, language: str = "hi-IN") -> bytes:
        """Text to speech."""
        if not self.key or self.key == "paste_your_sarvam_key_here":
            return b""
            
        payload = {
            "text": text[:400], 
            "target_language_code": language,
            "speaker": "anushka", 
            "model": "bulbul:v2",
            "enable_preprocessing": True
        }
        
        try:
            r = requests.post(
                f"{self.base}/text-to-speech",
                json=payload, headers=self._headers(), timeout=30
            )
            r.raise_for_status()
            audios = r.json().get("audios", [])
            return base64.b64decode(audios[0]) if audios else b""
        except Exception as ex:
            print(f"[Sarvam TTS error] {ex}")
            return b""