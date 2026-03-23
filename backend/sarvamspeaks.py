from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
import io
from neo4j import GraphDatabase


from sarvam_client import SarvamClient

app = Flask(__name__)
CORS(app) 

#Database Setup

driver = GraphDatabase.driver("bolt://localhost:7687", auth=("neo4j", "your_password_here")) #ha password change kara 

def get_context():
    try:
        with driver.session() as session:
            result = session.run("MATCH (c1)-[r]->(c2) RETURN c1.name, type(r), c2.name LIMIT 20")
            return " ".join([f"{r[0]} {r[1]} {r[2]}." for r in result])
    except Exception as e:
        print(f"Neo4j Error: {e}")
        return "No graph context available."


sarvam = SarvamClient()

system_rules = "You are a geopolitical analyst. Answer strictly based on the provided facts. Keep it to 2 sentences max. No markdown. Use Hindi."

# text input/output
@app.route('/api/chat', methods=['POST'])
def process_chat():
    data = request.json
    user_text = data.get('question')
    
    if not user_text:
        return jsonify({"error": "No question provided"}), 400
        
    print(f" Text Input: {user_text}")
    
    context = get_context()
    prompt = f"FACTS: {context}"
    
    answer = sarvam.generate(system=prompt + "\n" + system_rules, user=user_text)
    
    return jsonify({"response": answer})


# voice inout

@app.route('/api/voice', methods=['POST'])
def process_voice():
    if 'audio' not in request.files:
        return jsonify({"error": "No audio file found"}), 400
        
    audio_file = request.files['audio']
    audio_bytes = audio_file.read()
    
    print("\n Transcribing audio...")
    user_text = sarvam.transcribe(audio_bytes, language="hi-IN")
    
    if not user_text:
        return jsonify({"error": "Could not transcribe audio."}), 400
        
    print(f" AI Heard: {user_text}")
    
    context = get_context()
    prompt = f"FACTS: {context}"
    answer = sarvam.generate(system=prompt + "\n" + system_rules, user=user_text)
    print(f" AI Answer: {answer}")
    
    print(" Synthesizing audio...")
    response_audio_bytes = sarvam.synthesize(text=answer, language="hi-IN")
    
    if not response_audio_bytes:
         return jsonify({"error": "Failed to generate audio"}), 500
         
    return send_file(
        io.BytesIO(response_audio_bytes),
        mimetype="audio/wav"
    )

if __name__ == "__main__":
    print(" API Server running on port 5000")
    app.run(port=5000, debug=True)