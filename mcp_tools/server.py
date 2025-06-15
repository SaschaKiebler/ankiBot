from mcp.server.fastmcp import FastMCP
import os
import json
import re

mcp = FastMCP("StudyTools")

@mcp.tool()
async def get_hole_file_content(file_path: str) -> str:
    """Get all the file content as one string."""
    print("get_hole_file_content with file_path: " + file_path)
    with open(file_path, "r") as f:
        return f.read()


@mcp.tool()
async def get_file_content(file_path: str, chapter_number: int, heading_level: int = 2) -> str:
    """
    Extracts a specific chapter from a Markdown file based on heading level.
    A chapter is defined as the content under a heading of the specified level
    until the next heading of the same or higher level, or end of file.

    Args:
        file_path (str): The path to the Markdown file.
        chapter_number (int): The 1-indexed number of the chapter to retrieve.
        heading_level (int): The Markdown heading level to define chapters (e.g., 2 for ##).

    Returns:
        str: A JSON string containing 'chapter_title', 'chapter_content', 
             'total_chapters', 'current_chapter_index', or an 'error' message.
    """
    print("get_file_content with file_path: " + file_path + " and chapter_number: " + str(chapter_number) + " and heading_level: " + str(heading_level))
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            lines = f.readlines()
    except FileNotFoundError:
        return json.dumps({"error": f"File not found: {file_path}", "total_chapters": 0, "current_chapter_index": chapter_number, "chapter_title": "", "chapter_content": ""})
    except Exception as e:
        return json.dumps({"error": f"Error reading file: {str(e)}", "total_chapters": 0, "current_chapter_index": chapter_number, "chapter_title": "", "chapter_content": ""})

    if not lines:
        return json.dumps({"error": "File is empty.", "total_chapters": 0, "current_chapter_index": chapter_number, "chapter_title": "", "chapter_content": ""})

    chapters = []
    current_chapter_title = None
    current_chapter_lines = []
    
    # Pattern to identify the start of a new chapter at the specified heading_level
    chapter_start_pattern_text = r"^(" + "#" * heading_level + r")\s+(.*)"
    chapter_start_re = re.compile(chapter_start_pattern_text)

    # Pattern to identify any heading that would break the current chapter 
    # (i.e., a heading of the same level or any higher level up to H1)
    section_break_pattern_text = r"^(#{1,%d})\s+(.*)" % heading_level
    section_break_re = re.compile(section_break_pattern_text)

    for line_text in lines:
        match_section_break = section_break_re.match(line_text)
        
        if match_section_break:
            # This line is a heading. Check if it's the start of a new chapter of the desired level.
            is_new_target_chapter_heading = (len(match_section_break.group(1)) == heading_level)

            # If we were in a chapter, and this new heading means the old one ends
            if current_chapter_title is not None:
                chapters.append({
                    "title": current_chapter_title,
                    "content": "".join(current_chapter_lines)
                })
                current_chapter_lines = [] # Reset for the next chapter
                current_chapter_title = None # Mark that we are not actively in a chapter of interest yet
            
            if is_new_target_chapter_heading:
                current_chapter_title = match_section_break.group(2).strip()
            # If it's a higher-level heading (e.g. # when heading_level is 2 for ##),
            # it just ends the current chapter; we don't start a new one here unless it matches chapter_start_re.
            
        elif current_chapter_title is not None: # We are inside a chapter of the desired level, and this line is not a heading
            current_chapter_lines.append(line_text)

    # Add the last collected chapter if any
    if current_chapter_title is not None:
        chapters.append({
            "title": current_chapter_title,
            "content": "".join(current_chapter_lines)
        })

    total_chapters = len(chapters)

    if not chapters:
         return json.dumps({
            "error": f"No chapters found with heading level {heading_level} (e.g., {'#'*heading_level} Title).",
            "total_chapters": 0,
            "current_chapter_index": chapter_number,
            "chapter_title": "", 
            "chapter_content": ""
        })

    if 1 <= chapter_number <= total_chapters:
        chapter = chapters[chapter_number - 1]
        return json.dumps({
            "chapter_title": chapter["title"],
            "chapter_content": chapter["content"].strip(),
            "total_chapters": total_chapters,
            "current_chapter_index": chapter_number
        })
    else:
        return json.dumps({
            "error": f"Chapter number {chapter_number} is out of range. Total chapters: {total_chapters}.",
            "total_chapters": total_chapters,
            "current_chapter_index": chapter_number,
            "chapter_title": "", 
            "chapter_content": ""
        })
    

@mcp.tool()
async def create_qa_file(title: str, icon: str) -> str:
    """Create a QA file."""
    print("create_qa_file with title: " + title + " and icon: " + icon)
    script_dir = os.path.dirname(os.path.abspath(__file__))
    template_path = os.path.join(script_dir, "template.html")

    output_filename = "output_qa_file_" + title + ".html"
    # Output will be in the CWD of client.js. To place it in mcp_tools:
    # output_path = os.path.join(script_dir, output_filename)
    
    with open(output_filename, "w") as f: # Or use output_path here
        with open(template_path, "r") as template:
            f.write(template.read().replace("{{title}}", title).replace("{{icon}}", icon))
    return f"QA file {output_filename} created."

@mcp.tool()
async def write_to_qa_file(file_path: str, content: list) -> str:
    """Write to a QA file. The content should be a JSON object with the following format:
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
    with open(file_path, "a") as f:
        for item in content:
            f.write("""
                <ul class="toggle">
                <li>
                    <details open="">
                        <summary>""" + item["question"] + """</summary>
                        <p class="">""" + item["answer"] + """</p>
                    </details>
                </li>
                </ul>
                """)
    return "Content written to QA file."

@mcp.tool()
async def finish_qa_file(file_name: str) -> str:
    """Finish a QA file."""
    print("finish_qa_file with file_name: " + file_name)
    with open(file_name, "a") as f:
        f.write("\t</div>\n\t</article><span class=\"sans\" style=\"font-size:14px;padding-top:2em\"></span></body></html>")
    return "QA file finished."

if __name__ == "__main__":
    mcp.run()