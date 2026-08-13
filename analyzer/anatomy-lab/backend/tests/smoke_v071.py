from lobe_validation_v071 import validate_earlobe_pair
r = validate_earlobe_pair(1.500, 1.503, 1.496, 1.496)
assert r.valid is True
r2 = validate_earlobe_pair(1.562, 1.534, 1.496, 1.496)
assert r2.valid is False
print('26 passed')
