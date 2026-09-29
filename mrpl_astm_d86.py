import numpy as np
import sys

# Boiling point data provided for Bombay High Crude (BHC)
# Format: (Boiling Point C, Percentage of remaining liquid)
data = [
    (38, 100),  # IBP
    (95, 90),   # 10% boil off at 95C
    (180, 70),  # 30% boil off at 180C
    (265, 50),  # 50% boil off at 265C
    (340, 30),  # 70% boil off at 340C
    (440, 10),  # 90% boil off at 440C
    (520, 0)    # FBP
]

# Define the target fractions and their corresponding temperature ranges
fractions_ranges = {
    "Light Naphtha (<90C)": (0, 90),
    "Heavy Naphtha (90-150C)": (90, 150),
    "Kerosene/ATF (150-240C)": (150, 240),
    "Gasoil/Diesel (240-360C)": (240, 360),
    "Atmospheric Residue (>360C)": (360, 1000) # Using a high value for practical upper bound
}

# Create a structure to hold the results
results = {}

# Function for linear interpolation
def interpolate(x_target, x1, y1, x2, y2):
    if x2 == x1:
        return y1
    return y1 + (x_target - x1) * (y2 - y1) / (x2 - x1)

# Process the data points to create a mapping of boiling point to volume fraction
boiling_points = [d[0] for d in data]
volume_fractions = [d[1] for d in data]

print("Starting calculation using linear interpolation...")

# Calculate yields for each requested fraction
for name, (lower_bound, upper_bound) in fractions_ranges.items():
    # Find the segment in the data that spans the target range
    start_index = -1
    end_index = -1

    # Find the index of the first point greater than or equal to the lower bound
    for i in range(len(boiling_points)): 
        if boiling_points[i] >= lower_bound:
            start_index = i
            break

    # If no starting point found (e.g., below IBP), handle edge case if necessary
    if start_index == -1:
        continue

    # Find the index of the last point less than or equal to the upper bound
    for i in range(len(boiling_points) - 1, -1, -1):
        if boiling_points[i] <= upper_bound:
            end_index = i
            break

    # If end index is not found or start index is after end index, skip
    if end_index == -1 or end_index < start_index:
        continue

    # Get the corresponding data points for interpolation
    x1 = boiling_points[start_index]
    y1 = volume_fractions[start_index]
    x2 = boiling_points[end_index]
    y2 = volume_fractions[end_index]

    # Perform interpolation
    target_bp = (lower_bound + upper_bound) / 2
    interpolated_fraction = interpolate(target_bp, x1, y1, x2, y2)
    
    results[name] = f"{interpolated_fraction:.4f}"

# Output the final results
print("Volumetric Yield Calculations:")
for name, yield_str in results.items():
    print(f"{name}: {yield_str}%")

print("Calculation complete.")
