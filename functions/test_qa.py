import os
import json
import firebase_admin
from firebase_admin import credentials, firestore
from google.genai import client, types
from core.llm_config import LLMConfig
import importlib.util

# Load the local metadata agent
spec = importlib.util.spec_from_file_location("metadata_agent", "ai/agents/metadata_agent.py")
metadata_agent = importlib.util.module_from_spec(spec)
spec.loader.exec_module(metadata_agent)

if not firebase_admin._apps:
    firebase_admin.initialize_app()
db = firestore.client()

# Fetch a failing product
docs = db.collection('staging_products').where('status', '==', 'NEEDS_METADATA_REVIEW').limit(1).get()
if not docs:
    print("No failing products found to test.")
    exit(0)

product = docs[0].to_dict()
ai_data = product.get('ai_data', {})
name = product.get('pylon_data', {}).get('name', '')
grounding_text = ai_data.get('grounding_text', 'No text found.')

print(f"Testing QA Evaluation for: {name}")

client = LLMConfig.get_client()

result = metadata_agent.MetadataAgent._validate_metadata(client, name, ai_data, grounding_text)
print(json.dumps(result, indent=2, ensure_ascii=False))
