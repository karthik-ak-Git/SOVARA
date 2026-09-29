import sys

# Input parameters from inspection data
t_nominal = 38.0  # Nominal original wall thickness in mm
t_min = 28.5     # Minimum design allowable thickness in mm
year_install = 2014 # Installation year
measured_thickness = 31.8 # Current measured thickness in 2026 inspection

# Calculations

# (1) Total metal loss
total_metal_loss = t_nominal - measured_thickness

# Time elapsed since installation
years_elapsed = 2026 - year_install

# (2) Corrosion rate in mm/year
if years_elapsed > 0:
    corrosion_rate = total_metal_loss / years_elapsed
else:
    corrosion_rate = 0.0

# (3) Remaining service life in years
# Remaining thickness to be lost before reaching minimum allowable
remaining_thickness = measured_thickness - t_min

if corrosion_rate > 0:
    remaining_service_life = remaining_thickness / corrosion_rate
else:
    remaining_service_life = float('inf') # Infinite life if no loss is detected or rate is zero

# Output results
print("--- MRPL Corrosion Evaluation ---")
print(f"Nominal Wall Thickness: {t_nominal} mm")
print(f"Minimum Allowable Thickness: {t_min} mm")
print(f"Installation Year: {year_install}")
print(f"Measured Thickness (2026): {measured_thickness} mm")
print("----------------------------------")
print(f"(1) Total Metal Loss: {total_metal_loss:.2f} mm")
print(f"(2) Corrosion Rate: {corrosion_rate:.4f} mm/year")
print(f"(3) Remaining Service Life (to reach t_min): {remaining_service_life:.2f} years")
