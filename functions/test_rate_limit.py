import os
import sys

# Mock Firebase structure for basic syntax check
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

try:
    from ai.batch_processor import process_studio_queue, check_and_process_batches
    print("Imports passed successfully. The syntax is correct.")
except Exception as e:
    print(f"Error compiling syntax: {e}")
    import traceback
    traceback.print_exc()
