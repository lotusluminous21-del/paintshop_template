import json
import zipfile
import re
import sys

def parse_xlsx(file_path):
    with zipfile.ZipFile(file_path, "r") as z:
        # read shared strings
        shared_strings = []
        if "xl/sharedStrings.xml" in z.namelist():
            xml = z.read("xl/sharedStrings.xml").decode("utf-8")
            from xml.etree import ElementTree as ET
            root = ET.fromstring(xml)
            for si in root.findall("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}si"):
                texts = si.findall(".//{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t")
                shared_strings.append("".join([t.text for t in texts if t.text]))

        # read first sheet
        sheet_xml = z.read("xl/worksheets/sheet1.xml").decode("utf-8")
        from xml.etree import ElementTree as ET
        root = ET.fromstring(sheet_xml)
        
        headers = []
        for row in root.findall(".//{http://schemas.openxmlformats.org/spreadsheetml/2006/main}row")[:1]:
            for cell in row.findall("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}c"):
                val = cell.find("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}v")
                if val is not None:
                    if cell.get("t") == "s":
                        headers.append(shared_strings[int(val.text)])
                    else:
                        headers.append(val.text)
        print(headers)

if __name__ == "__main__":
    parse_xlsx(sys.argv[1])
