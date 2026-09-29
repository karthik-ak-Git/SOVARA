import math

# Given parameters
L = 500.0  # Length of pipe in meters
rho = 850.0  # Fluid density in kg/m3
mu = 0.005  # Dynamic viscosity in Pa*s
D = 0.3  # Pipe internal diameter in meters
Q_m3h = 250.0  # Flow rate in m3/h
epsilon_mm = 0.045  # Absolute roughness in mm

# Conversion factors
Q_ms = Q_m3h / 3600.0  # Convert flow rate to m3/s
epsilon_m = epsilon_mm / 1000.0  # Convert roughness to meters

# 1. Calculate cross-sectional area and velocity
A = (math.pi / 4) * (D**2)
Velocity = Q_ms / A

# 2. Calculate Reynolds number
Re = (rho * Velocity * D) / mu

# 3. Calculate friction factor using the Colebrook equation approximation (Swamee-Jain method for simplicity and directness in a script)
# Note: For high accuracy, an iterative solution is preferred, but Swamee-Jain provides a good estimate.
relative_roughness = epsilon_m / D

if relative_roughness <= 0.0634
    f = 0.41 # Laminar flow approximation for very smooth pipes (or use Poiseuille if needed)
else
    # Swamee-Jain explicit approximation for friction factor f
    f = (0.25 / math.log10(relative_roughness / 3.7 + (5.74 / math.pow(Re, 0.9)))**2)

# 4. Calculate pressure drop using Darcy-Weisbach equation (Head Loss H = f * (L/D) * (V^2 / 2))
HeadLoss_m = f * (L / D) * (Velocity**2 / 2)

# 5. Calculate pressure drop in Pascals
PressureDrop_Pa = rho * HeadLoss_m

# Convert to desired units
PressureDrop_kPa = PressureDrop_Pa / 1000.0
PressureDrop_bar = PressureDrop_Pa / 100000.0

# Output results
print("--- Pipeline Hydraulics Results ---")
print(f"Reynolds Number: {Re:.2f}")
print(f"Friction Factor (f): {f:.4f}")
print(f"Total Pressure Drop: {PressureDrop_kPa:.3f} kPa")
print(f"Total Pressure Drop: {PressureDrop_bar:.3f} bar")