# EXPERIENCE.md - ShopKart

## Information Architecture

| Surface | Reached from | Purpose |
|---|---|---|
| Home | App open | Search, browse categories, and see banners and deal grids |
| Product detail | Clicking a product card on Home | See one product's images, price, offers, and buy actions |

## Home

Purpose: The marketplace homepage - search, browse categories, and scan banners and deal grids.
Story: home-landing
Layout:
- A bold blue top header bar spanning the full width. On the left: the "ShopKart" logo with a small italic "Explore Plus" tag and a tiny yellow star above it. In the center: a wide white rounded search bar with a blue search icon and placeholder text. On the right: a white "Login" button, a "Become a Seller" link, a "More" dropdown with a chevron, and a cart icon with the label "Cart".
- A white category strip directly below the header: a horizontal row of about eight category items, each a small circular/square product thumbnail above a label with a tiny dropdown chevron - Top Offers, Mobiles, Fashion, Electronics, Home & Furniture, Appliances, Beauty & More, Grocery.
- A full-width hero banner/carousel area with a large promotional image, small left and right arrow controls, and a row of dot indicators at the bottom.
- A "Deals of the Day" white section card: a narrow left rail with the title "Deals of the Day", a small countdown timer, and a blue "VIEW ALL" button; to the right, a horizontal row of about five product cards.
- A "Best of Electronics" white section: a section title on the left and a horizontal row of about five product cards, with right-arrow control.
- A "Fashion Top Deals" white section: a section title and a horizontal row of about five product cards.
- Each product card shows: a product image, a short product name on one or two lines, a deal line such as "Up to 80% Off", and a small muted tag like "Top Brands".
Microcopy:
- logo: "ShopKart"
- plus: "Explore Plus"
- search: "Search for products, brands and more"
- login: "Login"
- seller: "Become a Seller"
- more: "More"
- cart: "Cart"
- dealsTitle: "Deals of the Day"
- viewAll: "VIEW ALL"
- electronicsTitle: "Best of Electronics"
- fashionTitle: "Fashion Top Deals"
- dealLine: "Up to 80% Off"
States:
- default: the banner and all product grids are populated with sample products and prices
Nav:
- A product card -> Product detail
- VIEW ALL -> Product detail

## Product detail

Purpose: View one product's images, price, offers, and buy actions.
Story: product-detail
Layout:
- The same bold blue top header bar as Home (logo, search bar, Login, Cart) with a back chevron on the far left.
- A two-column main area on a white surface:
  - Left column: a large primary product image with a vertical strip of small thumbnail images beside it; below the image, two large buttons side by side - an orange "ADD TO CART" button and a yellow "BUY NOW" button.
  - Right column: the product title, a small green rating badge like "4.3 ★" with a muted rating count beside it, the price as a large bold number with a struck-through original price and a green discount percent, an "Available offers" list with three bullet points, and a delivery row reading "Free delivery".
- A "Specifications" white section below with a simple two-column table of attribute and value rows.
Microcopy:
- addToCart: "ADD TO CART"
- buyNow: "BUY NOW"
- offersTitle: "Available offers"
- specsTitle: "Specifications"
- delivery: "Free delivery"
- rating: "4.3 ★"
States:
- in-stock: the buy buttons are enabled
Nav:
- Back -> Home
