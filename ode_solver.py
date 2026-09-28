import sympy as sp

# Define the independent variable and the function
x = sp.symbols('x')
y = sp.Function('y')

# Get input from user for LHS and RHS
LHS = sp.sympify(input("Enter the value of LHS: "))
RHS = sp.sympify(input("Enter the value of RHS: "))

# Create the ODE
ODE = sp.Eq(LHS, RHS)

# Solve the ODE
gs = sp.dsolve(ODE, y(x))

# Print the general solution
print("The General Solution of given DE is:")
sp.pprint(gs)

# Calculate the order of the ODE
order = sp.ode_order(ODE, y)
print("The order of the given ODE is:", order)
