#!/bin/bash

# Clean metadata with MAT2
mat2 --inplace resume-clean.pdf

# Inject custom metadata
exiftool -Title="My Custom Title" -Author="Your Name" -Subject="Document Subject" -Keywords="keyword1,keyword2" -Creator="My Application" resume-clean.pdf -o resume-title.pdf

# Verify metadata
exiftool resume-title.pdf
