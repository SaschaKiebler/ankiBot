from mcp.server.fastmcp import FastMCP
import os
import json
import genanki
import random
import hashlib
import html

mcp = FastMCP("StudyTools")

@mcp.tool()
async def get_hole_file_content(file_path: str) -> str:
    """Get all the file content as one string."""
    print("get_hole_file_content with file_path: " + file_path)
    with open(file_path, "r") as f:
        return f.read()
    

@mcp.tool()
async def create_qa_file(title: str, icon: str, job_id: str) -> str:
    """Create a QA file."""
    print("create_qa_file with title: " + title + " and icon: " + icon + " and job_id: " + job_id)
    output_filename = "output_qa_file_" + title + "_" + job_id + ".json"
    
    with open(output_filename, "w") as f:
        f.write(json.dumps({"title": title, "icon": icon, "job_id": job_id, "qa_pairs": []}))
    
    full_path = os.path.abspath(output_filename)
    return json.dumps({"message": "QA file {output_filename} created. Job id: {job_id}", "file_path": full_path})

@mcp.tool()
async def write_to_qa_file(file_path: str, content: list) -> str:
    """Write to a QA file. use with 6-7 questions at a time. The content should be a JSON object with the following format:
    [{
        "question": "The question.",
        "answer": "The answer."
    },
    {
        "question": "The question.",
        "answer": "The answer."
    },
    ...]
    """
    print("write_to_qa_file with file_path: " + file_path + " and content: " + str(content))
    # Initialize with a default structure
    data_to_write = {"qa_pairs": []}

    try:
        with open(file_path, "r") as f:
            file_content = f.read()
            if file_content.strip():  # Ensure content is not just whitespace
                loaded_data = json.loads(file_content)
                # Ensure the loaded data has 'qa_pairs' and it's a list
                if isinstance(loaded_data, dict) and isinstance(loaded_data.get("qa_pairs"), list):
                    data_to_write = loaded_data
                else:
                    # Loaded data is not in the expected format, or 'qa_pairs' is missing/wrong type.
                    print(f"Warning: File {file_path} did not contain the expected JSON structure (dict with 'qa_pairs' list). Starting with a new structure.")
            # If file_content is empty or whitespace, data_to_write remains {"qa_pairs": []}
            
    except FileNotFoundError:
        # File doesn't exist, will be created with data_to_write (which is {"qa_pairs": []} initially)
        print(f"Info: File {file_path} not found. A new file will be created.")
    except json.JSONDecodeError:
        # File exists but contains invalid JSON.
        # data_to_write remains {"qa_pairs": []}, and the file will be overwritten.
        print(f"Warning: File {file_path} contained invalid JSON. It will be overwritten with new content.")
    
    # Ensure 'qa_pairs' key exists and is a list, even if it was somehow lost
    if "qa_pairs" not in data_to_write or not isinstance(data_to_write.get("qa_pairs"), list):
        data_to_write["qa_pairs"] = []

    # Append new content
    data_to_write["qa_pairs"].extend(content)
    
    # Write back to the file
    try:
        with open(file_path, "w") as fw:
            json.dump(data_to_write, fw, indent=4) # Use json.dump for writing to file object and add indent
    except IOError as e:
        print(f"Error writing to file {file_path}: {e}")
        return f"Error writing to file: {e}" # Return an error message
        
    return "Content written to QA file."

@mcp.tool()
async def finish_qa_file(file_path: str) -> str:
    """Finish a QA file and generate an Anki deck.
    Always has to be called after you finished writing all content to the QA file.
    Generates an .apkg file from the qa_pairs."""
    print(f"finish_qa_file with file_path: {file_path}")

    try:
        # Ensure UTF-8 encoding for broader compatibility
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        return json.dumps({"error": "Input JSON file not found.", "file_path": file_path, "status": "error"})
    except json.JSONDecodeError:
        return json.dumps({"error": "Invalid JSON format in input file.", "file_path": file_path, "status": "error"})
    except Exception as e:
        return json.dumps({"error": f"Error reading input file: {str(e)}", "file_path": file_path, "status": "error"})

    title = data.get("title", "Untitled Deck")
    icon = data.get("icon", "")  # Default to empty string if not present
    job_id = data.get("job_id")
    qa_pairs = data.get("qa_pairs", [])

    if not job_id:
        return json.dumps({"error": "job_id is missing in the JSON file.", "file_path": file_path, "status": "error"})
    
    if not qa_pairs:
        return json.dumps({
            "message": "No QA pairs found. Anki deck generation skipped.",
            "job_id": job_id,
            "file_path": file_path, # Original JSON path
            "status": "success_no_cards" 
        })

    # Generate a unique integer ID for the deck from the job_id string
    deck_id_hash = hashlib.sha256(job_id.encode('utf-8')).hexdigest()
    deck_id = int(deck_id_hash[:15], 16)  # Use first 15 hex chars

    deck_title = f"{icon} {title}".strip()
    if not deck_title: # Ensure deck title is not empty if icon and title were empty
        deck_title = job_id 

    # Define Anki Model
    model_id_hash = hashlib.sha256(f"{job_id}_model".encode('utf-8')).hexdigest()
    model_id = int(model_id_hash[:15], 16)
    
    my_model = genanki.Model(
        model_id,
        f'Simple Model for {title if title else job_id}', # Model name
        fields=[
            {'name': 'Question'},
            {'name': 'Answer'},
        ],
        templates=[
            {
                'name': 'Card 1',
                'qfmt': '{{Question}}',  # Question format
                'afmt': '{{FrontSide}}<hr id="answer">{{Answer}}',  # Answer format
            },
        ])

    anki_deck = genanki.Deck(deck_id, deck_title)

    notes_added_count = 0
    for i, pair in enumerate(qa_pairs):
        question = pair.get('question')
        answer = pair.get('answer')

        if question and answer:
            question_escaped = html.escape(question)
            answer_escaped = html.escape(answer)

            note_guid = genanki.guid_for(job_id, str(i)) # Stable GUID
            note = genanki.Note(
                model=my_model,
                fields=[question_escaped, answer_escaped],
                guid=note_guid
            )
            anki_deck.add_note(note)
            notes_added_count += 1
        else:
            print(f"Skipping QA pair at index {i} for job_id {job_id} due to missing 'q' or 'a': {pair}")
    
    if notes_added_count == 0:
        return json.dumps({
            "message": "No valid QA pairs found to create notes. Anki deck generation skipped.",
            "job_id": job_id,
            "file_path": file_path,
            "status": "success_no_valid_cards"
        })

    anki_package = genanki.Package(anki_deck)

    input_dir = os.path.dirname(file_path)
    if not input_dir: 
        input_dir = "." 
    output_decks_dir = os.path.join(input_dir, "anki_decks_output")
    os.makedirs(output_decks_dir, exist_ok=True)
    
    apkg_filename = f"{job_id}.apkg"
    apkg_file_path = os.path.join(output_decks_dir, apkg_filename)

    try:
        anki_package.write_to_file(apkg_file_path)
        return json.dumps({
            "message": f"Anki deck '{deck_title}' created successfully.",
            "apkg_file_path": apkg_file_path,
            "job_id": job_id,
            "notes_added": notes_added_count,
            "status": "success"
        })
    except Exception as e:
        print(f"Error writing Anki package for job_id {job_id}: {e}")
        return json.dumps({
            "error": f"Failed to write Anki package: {str(e)}",
            "job_id": job_id,
            "status": "error"
        })

if __name__ == "__main__":
    mcp.run()