import math

# Input parameters
Q = 450  # Flow rate in US GPM
SG = 1.0 # Specific gravity
P1 = 65  # Upstream pressure in psia
P2 = 45  # Downstream pressure in psia
Cv_std = 110.0 # Standard Cv for 3-inch valve

# Calculate Delta P
Delta_P = P1 - P2

# Calculate required flow coefficient (Cv)
# Cv = Q * sqrt(SG / Delta P)
if Delta_P <= 0:
    raise ValueError("Downstream pressure must be less than upstream pressure")

required_cv = Q * math.sqrt(SG / Delta_P)

print(f"Calculated Flow Rate Q: {Q} US GPM")
print(f"Pressure Difference Delta P: {Delta_P} psia")
print(f"Required Flow Coefficient Cv: {required_cv:.2f}")

# Check operating margin
lower_bound = Cv_std * 0.20  # 20% opening
upper_bound = Cv_std * 0.80  # 80% opening

print(f"Standard Valve Cv: {Cv_std:.2f}")
print(f"Required operating margin range for standard valve: {lower_bound:.2f} to {upper_bound:.2f}")

if lower_bound <= required_cv <= upper_bound:
    print("Result: The standard 3-inch valve provides sufficient operating margin.")
else:
    print("Result: The standard 3-inch valve does not provide sufficient operating margin based on calculated Cv.")