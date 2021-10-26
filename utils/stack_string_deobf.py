#!/usr/bin/python

import math


magic_string = ["zeWURhDQZoAbrw_F4km9tlOI5ysBHYE0JC67KS8avqz1gdGpNX3uTnL2VMiPcfj$",
				  "OnlSegCJXqkRd9UsrtoD57fhyviG0Qc2IWTaP_KNmMLZA18FEzVu3BYjzp4bHw6$",
				  "jGi8LrT1_SpIE7930DOtezvhgzamMZbuwQUBRdYnJlKN4sc6XPoHWCVk52FfqAy$"]

def deobfuscate(args):
	chunk_index = 0
	output = ""

	index_string = args.pop() 
	chunk_number = args.pop()
	src_string = magic_string[index_string]

	while (chunk_index < chunk_number):
		# print("---------chunk_index is: " + str(chunk_index))
		key = args.pop()
		char_index = 0
		semi_string_from_chunk = ""

		while (key > 0):
			# print("key is: " + str(key))
			char_index = key % (len(src_string)+ 1)
			# print("char_index is: " + str(char_index))
			semi_string_from_chunk += src_string[char_index - 1]
			# print("semi_string_from_chunk is: " + str(semi_string_from_chunk))
			key = math.floor(key / (len(src_string) + 1))

		output += semi_string_from_chunk
		chunk_index += 1

	return output


def containsAll(str, set):
	""" Check whether sequence str contains ALL of the items in set. """
	return 0 not in [c in str for c in set]

def obfuscate(string):
	print("Input string is: " + string)

	magic_string_index = 0

	# Check which magic string use
	for mgs in magic_string:
		if containsAll( mgs, string):
			magic_string_index = magic_string.index(mgs)
			print("Found suitable magic string with index: " + str(magic_string_index))
			break
	else:
		print("There are no suitable magic string for the input: " + string)
		print("Aborting!")
		quit(-1)

	magic = magic_string[magic_string_index]
	key = 0

	string = string[::-1]

	for c in string:
		key += magic.index(c) + 1
		key = key * (len(magic) + 1)

	key = math.floor(key / (len(magic) + 1))


	out = []
	out.append(key)
	out.append(1)
	out.append(magic_string_index)
	return out



result = obfuscate("hello")
print("Your obfuscated result is: " + str(result))
print(deobfuscate(result))

# # Removes stack-based string obfuscation from collina. Note it's checking for "En"

# most_recent_params = []
# new_line = ""
# with open("../collinas/collina_orig_unflattened_reversing.js", "r") as file:
# 	for line in file.readlines():
# 		if "e(14, 2, -1);" in line:
# 			spaces = line[:line.find("e(14, 2, -1);")]
# 			new_line = ''.join([spaces, "// ", "e(14, 2, -1);"])
# 		elif "w.push" in line and "En" in line:
# 			# Ignore this, since it's the only useful push: the one inside the string decoding function
# 			new_line = line.rstrip()
# 		elif "w.push" in line:
# 			start = line.find("(")
# 			end = line.find(")")
# 			most_recent_params = [int(param) for param in line[start+1:end].split(", ")]

# 			spaces = line[:line.find("w.push")]
# 			new_line = ''.join([spaces, "// ", "w.push(", line[start+1:end], ");"])
# 		elif "w.pop" in line and len(most_recent_params) > 0:
# 			spaces = len(line) - len(line.lstrip())
# 			spaces_and_identifier = line.find("w.pop")
# 			new_line = line[:spaces] + "// " + line[spaces:] + line[:spaces_and_identifier] + '"' + deobfuscate(most_recent_params) + '";'
# 		else: new_line = line.rstrip()

# 		print(new_line)
