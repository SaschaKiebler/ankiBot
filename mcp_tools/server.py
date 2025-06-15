from mcp.server.fastmcp import FastMCP
import os
import json
import uuid

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
    script_dir = os.path.dirname(os.path.abspath(__file__))
    template_path = os.path.join(script_dir, "template.html")

    output_filename = "output_qa_file_" + title + "_" + job_id + ".html"
    
    with open(output_filename, "w") as f: # Or use output_path here
        with open(template_path, "r") as template:
            f.write(template.read().replace("{{title}}", title).replace("{{icon}}", icon))
    
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
    with open(file_path, "a") as f:
        for item in content:
            f.write("""
                <ul id='""" + str(uuid.uuid4()) + """' class="toggle">
                <li>
                    <details open="">
                        <summary>""" + item["question"] + """</summary>
                        <p id='""" + str(uuid.uuid4()) + """' class="">""" + item["answer"] + """</p>
                    </details>
                </li>
                </ul>
                """)
    return "Content written to QA file."

@mcp.tool()
async def finish_qa_file(file_path: str) -> str:
    """Finish a QA file. always has to be called after you finished writing all content to the QA file."""
    print("finish_qa_file with file_path: " + file_path)
    with open(file_path, "a") as f:
        f.write("\t</div>\n\t</article><span class=\"sans\" style=\"font-size:14px;padding-top:2em\"></span></body></html>")
    # get the full path of the file
    full_path = os.path.abspath(file_path)
    return json.dumps({"message": "QA file finished Answer to the User now", "file_path": full_path})

if __name__ == "__main__":
    mcp.run()